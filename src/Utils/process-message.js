var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { proto } from '../../WAProto/index.js';
import { WAMessageStubType } from '../Types';
import { getContentType, normalizeMessageContent } from '../Utils/messages';
import { areJidsSameUser, isHostedLidUser, isHostedPnUser, isJidBroadcast, isJidStatusBroadcast, isLidUser, jidDecode, jidEncode, jidNormalizedUser } from '../WABinary';
import { aesDecryptGCM, hmacSign } from './crypto';
import { getKeyAuthor, toNumber } from './generics';
import { downloadAndProcessHistorySyncNotification } from './history';
import { buildMergedTcTokenIndexWrite, resolveTcTokenJid } from './tc-token-utils';
const REAL_MSG_STUB_TYPES = new Set([
    WAMessageStubType.CALL_MISSED_GROUP_VIDEO,
    WAMessageStubType.CALL_MISSED_GROUP_VOICE,
    WAMessageStubType.CALL_MISSED_VIDEO,
    WAMessageStubType.CALL_MISSED_VOICE
]);
const REAL_MSG_REQ_ME_STUB_TYPES = new Set([WAMessageStubType.GROUP_PARTICIPANT_ADD]);
function storeTcTokensFromHistorySync(chats, signalRepository, keyStore, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const getLIDForPN = signalRepository.lidMapping.getLIDForPN.bind(signalRepository.lidMapping);
        const candidates = [];
        for (const chat of chats) {
            const ts = chat.tcTokenTimestamp ? toNumber(chat.tcTokenTimestamp) : 0;
            if (((_a = chat.tcToken) === null || _a === void 0 ? void 0 : _a.length) && ts > 0) {
                const jid = jidNormalizedUser(chat.id);
                const storageJid = yield resolveTcTokenJid(jid, getLIDForPN);
                candidates.push({
                    storageJid,
                    token: Buffer.from(chat.tcToken),
                    ts,
                    senderTs: chat.tcTokenSenderTimestamp ? toNumber(chat.tcTokenSenderTimestamp) : undefined
                });
            }
        }
        if (!candidates.length) {
            return;
        }
        const jids = candidates.map(c => c.storageJid);
        const existing = yield keyStore.get('tctoken', jids);
        const entries = {};
        for (const c of candidates) {
            const existingEntry = existing[c.storageJid];
            const existingTs = (existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry.timestamp) ? Number(existingEntry.timestamp) : 0;
            if (existingTs > 0 && existingTs >= c.ts) {
                continue;
            }
            entries[c.storageJid] = Object.assign(Object.assign(Object.assign({}, existingEntry), { token: c.token, timestamp: String(c.ts) }), (c.senderTs !== undefined ? { senderTimestamp: c.senderTs } : {}));
        }
        if (Object.keys(entries).length) {
            logger === null || logger === void 0 ? void 0 : logger.debug({ count: Object.keys(entries).length }, 'storing tctokens from history sync');
            try {
                // Include updated __index so cross-session pruning picks these JIDs up.
                const indexWrite = yield buildMergedTcTokenIndexWrite(keyStore, Object.keys(entries));
                yield keyStore.set({ tctoken: Object.assign(Object.assign({}, entries), indexWrite) });
            }
            catch (err) {
                logger === null || logger === void 0 ? void 0 : logger.warn({ err }, 'failed to store tctokens from history sync');
            }
        }
    });
}
/** Cleans a received message to further processing */
export const cleanMessage = (message, meId, meLid) => {
    var _a, _b, _c;
    // ensure remoteJid and participant doesn't have device or agent in it
    if (isHostedPnUser(message.key.remoteJid) || isHostedLidUser(message.key.remoteJid)) {
        message.key.remoteJid = jidEncode((_b = jidDecode((_a = message.key) === null || _a === void 0 ? void 0 : _a.remoteJid)) === null || _b === void 0 ? void 0 : _b.user, isHostedPnUser(message.key.remoteJid) ? 's.whatsapp.net' : 'lid');
    }
    else {
        message.key.remoteJid = jidNormalizedUser(message.key.remoteJid);
    }
    if (isHostedPnUser(message.key.participant) || isHostedLidUser(message.key.participant)) {
        message.key.participant = jidEncode((_c = jidDecode(message.key.participant)) === null || _c === void 0 ? void 0 : _c.user, isHostedPnUser(message.key.participant) ? 's.whatsapp.net' : 'lid');
    }
    else {
        message.key.participant = jidNormalizedUser(message.key.participant);
    }
    const content = normalizeMessageContent(message.message);
    // if the message has a reaction, ensure fromMe & remoteJid are from our perspective
    if (content === null || content === void 0 ? void 0 : content.reactionMessage) {
        normaliseKey(content.reactionMessage.key);
    }
    if (content === null || content === void 0 ? void 0 : content.pollUpdateMessage) {
        normaliseKey(content.pollUpdateMessage.pollCreationMessageKey);
    }
    function normaliseKey(msgKey) {
        // if the reaction is from another user
        // we've to correctly map the key to this user's perspective
        if (!message.key.fromMe) {
            // if the sender believed the message being reacted to is not from them
            // we've to correct the key to be from them, or some other participant
            msgKey.fromMe = !msgKey.fromMe
                ? areJidsSameUser(msgKey.participant || msgKey.remoteJid, meId) ||
                    areJidsSameUser(msgKey.participant || msgKey.remoteJid, meLid)
                : // if the message being reacted to, was from them
                    // fromMe automatically becomes false
                    false;
            // set the remoteJid to being the same as the chat the message came from
            // TODO: investigate inconsistencies
            msgKey.remoteJid = message.key.remoteJid;
            // set participant of the message
            msgKey.participant = msgKey.participant || message.key.participant;
        }
    }
};
// TODO: target:audit AUDIT THIS FUNCTION AGAIN
export const isRealMessage = (message) => {
    const normalizedContent = normalizeMessageContent(message.message);
    const hasSomeContent = !!getContentType(normalizedContent);
    return ((!!normalizedContent ||
        REAL_MSG_STUB_TYPES.has(message.messageStubType) ||
        REAL_MSG_REQ_ME_STUB_TYPES.has(message.messageStubType)) &&
        hasSomeContent &&
        !(normalizedContent === null || normalizedContent === void 0 ? void 0 : normalizedContent.protocolMessage) &&
        !(normalizedContent === null || normalizedContent === void 0 ? void 0 : normalizedContent.reactionMessage) &&
        !(normalizedContent === null || normalizedContent === void 0 ? void 0 : normalizedContent.pollUpdateMessage));
};
export const shouldIncrementChatUnread = (message) => !message.key.fromMe && !message.messageStubType;
/**
 * Get the ID of the chat from the given key.
 * Typically -- that'll be the remoteJid, but for broadcasts, it'll be the participant
 */
export const getChatId = ({ remoteJid, participant, fromMe }) => {
    if (isJidBroadcast(remoteJid) && !isJidStatusBroadcast(remoteJid) && !fromMe) {
        return participant;
    }
    return remoteJid;
};
/**
 * Decrypt a poll vote
 * @param vote encrypted vote
 * @param ctx additional info about the poll required for decryption
 * @returns list of SHA256 options
 */
export function decryptPollVote({ encPayload, encIv }, { pollCreatorJid, pollMsgId, pollEncKey, voterJid }) {
    const sign = Buffer.concat([
        toBinary(pollMsgId),
        toBinary(pollCreatorJid),
        toBinary(voterJid),
        toBinary('Poll Vote'),
        new Uint8Array([1])
    ]);
    const key0 = hmacSign(pollEncKey, new Uint8Array(32), 'sha256');
    const decKey = hmacSign(sign, key0, 'sha256');
    const aad = toBinary(`${pollMsgId}\u0000${voterJid}`);
    const decrypted = aesDecryptGCM(encPayload, decKey, encIv, aad);
    return proto.Message.PollVoteMessage.decode(decrypted);
    function toBinary(txt) {
        return Buffer.from(txt);
    }
}
/**
 * Decrypt an event response
 * @param response encrypted event response
 * @param ctx additional info about the event required for decryption
 * @returns event response message
 */
export function decryptEventResponse({ encPayload, encIv }, { eventCreatorJid, eventMsgId, eventEncKey, responderJid }) {
    const sign = Buffer.concat([
        toBinary(eventMsgId),
        toBinary(eventCreatorJid),
        toBinary(responderJid),
        toBinary('Event Response'),
        new Uint8Array([1])
    ]);
    const key0 = hmacSign(eventEncKey, new Uint8Array(32), 'sha256');
    const decKey = hmacSign(sign, key0, 'sha256');
    const aad = toBinary(`${eventMsgId}\u0000${responderJid}`);
    const decrypted = aesDecryptGCM(encPayload, decKey, encIv, aad);
    return proto.Message.EventResponseMessage.decode(decrypted);
    function toBinary(txt) {
        return Buffer.from(txt);
    }
}
const processMessage = (message_1, _a) => __awaiter(void 0, [message_1, _a], void 0, function* (message, { shouldProcessHistoryMsg, placeholderResendCache, ev, creds, signalRepository, keyStore, logger, options, getMessage }) {
    var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    const meId = creds.me.id;
    const { accountSettings } = creds;
    const chat = { id: jidNormalizedUser(getChatId(message.key)) };
    const isRealMsg = isRealMessage(message);
    if (isRealMsg) {
        chat.messages = [{ message }];
        chat.conversationTimestamp = toNumber(message.messageTimestamp);
        // only increment unread count if not CIPHERTEXT and from another person
        if (shouldIncrementChatUnread(message)) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
        }
    }
    const content = normalizeMessageContent(message.message);
    // unarchive chat if it's a real message, or someone reacted to our message
    // and we've the unarchive chats setting on
    if ((isRealMsg || ((_c = (_b = content === null || content === void 0 ? void 0 : content.reactionMessage) === null || _b === void 0 ? void 0 : _b.key) === null || _c === void 0 ? void 0 : _c.fromMe)) && (accountSettings === null || accountSettings === void 0 ? void 0 : accountSettings.unarchiveChats)) {
        chat.archived = false;
        chat.readOnly = false;
    }
    const protocolMsg = content === null || content === void 0 ? void 0 : content.protocolMessage;
    if (protocolMsg) {
        switch (protocolMsg.type) {
            case proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION:
                const histNotification = protocolMsg.historySyncNotification;
                const process = shouldProcessHistoryMsg;
                const isLatest = !((_d = creds.processedHistoryMessages) === null || _d === void 0 ? void 0 : _d.length);
                logger === null || logger === void 0 ? void 0 : logger.info({
                    histNotification,
                    process,
                    id: message.key.id,
                    isLatest
                }, 'got history notification');
                if (process) {
                    // TODO: investigate
                    if (histNotification.syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) {
                        ev.emit('creds.update', {
                            processedHistoryMessages: [
                                ...(creds.processedHistoryMessages || []),
                                { key: message.key, messageTimestamp: message.messageTimestamp }
                            ]
                        });
                    }
                    const data = yield downloadAndProcessHistorySyncNotification(histNotification, options, logger);
                    if ((_e = data.lidPnMappings) === null || _e === void 0 ? void 0 : _e.length) {
                        logger === null || logger === void 0 ? void 0 : logger.debug({ count: data.lidPnMappings.length }, 'processing LID-PN mappings from history sync');
                        yield signalRepository.lidMapping
                            .storeLIDPNMappings(data.lidPnMappings)
                            .catch(err => logger === null || logger === void 0 ? void 0 : logger.warn({ err }, 'failed to store LID-PN mappings from history sync'));
                    }
                    yield storeTcTokensFromHistorySync(data.chats, signalRepository, keyStore, logger);
                    ev.emit('messaging-history.set', Object.assign(Object.assign({}, data), { isLatest: histNotification.syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND ? isLatest : undefined, chunkOrder: histNotification.chunkOrder, peerDataRequestSessionId: histNotification.peerDataRequestSessionId }));
                }
                break;
            case proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_SHARE:
                const keys = protocolMsg.appStateSyncKeyShare.keys;
                if (keys === null || keys === void 0 ? void 0 : keys.length) {
                    let newAppStateSyncKeyId = '';
                    yield keyStore.transaction(() => __awaiter(void 0, void 0, void 0, function* () {
                        const newKeys = [];
                        for (const { keyData, keyId } of keys) {
                            const strKeyId = Buffer.from(keyId.keyId).toString('base64');
                            newKeys.push(strKeyId);
                            yield keyStore.set({ 'app-state-sync-key': { [strKeyId]: keyData } });
                            newAppStateSyncKeyId = strKeyId;
                        }
                        logger === null || logger === void 0 ? void 0 : logger.info({ newAppStateSyncKeyId, newKeys }, 'injecting new app state sync keys');
                    }), meId);
                    ev.emit('creds.update', { myAppStateKeyId: newAppStateSyncKeyId });
                }
                else {
                    logger === null || logger === void 0 ? void 0 : logger.info({ protocolMsg }, 'recv app state sync with 0 keys');
                }
                break;
            case proto.Message.ProtocolMessage.Type.REVOKE:
                ev.emit('messages.update', [
                    {
                        key: Object.assign(Object.assign({}, message.key), { id: protocolMsg.key.id }),
                        update: { message: null, messageStubType: WAMessageStubType.REVOKE, key: message.key }
                    }
                ]);
                break;
            case proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING:
                Object.assign(chat, {
                    ephemeralSettingTimestamp: toNumber(message.messageTimestamp),
                    ephemeralExpiration: protocolMsg.ephemeralExpiration || null
                });
                break;
            case proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE:
                const response = protocolMsg.peerDataOperationRequestResponseMessage;
                if (response) {
                    // TODO: IMPLEMENT HISTORY SYNC ETC (sticker uploads etc.).
                    const peerDataOperationResult = response.peerDataOperationResult || [];
                    for (const result of peerDataOperationResult) {
                        const retryResponse = result === null || result === void 0 ? void 0 : result.placeholderMessageResendResponse;
                        //eslint-disable-next-line max-depth
                        if (!(retryResponse === null || retryResponse === void 0 ? void 0 : retryResponse.webMessageInfoBytes)) {
                            continue;
                        }
                        //eslint-disable-next-line max-depth
                        try {
                            const webMessageInfo = proto.WebMessageInfo.decode(retryResponse.webMessageInfoBytes);
                            const msgId = (_f = webMessageInfo.key) === null || _f === void 0 ? void 0 : _f.id;
                            // Retrieve cached original message data (preserves LID details,
                            // timestamps, etc. that the phone may omit in its PDO response)
                            const cachedData = msgId ? yield (placeholderResendCache === null || placeholderResendCache === void 0 ? void 0 : placeholderResendCache.get(msgId)) : undefined;
                            //eslint-disable-next-line max-depth
                            if (msgId) {
                                yield (placeholderResendCache === null || placeholderResendCache === void 0 ? void 0 : placeholderResendCache.del(msgId));
                            }
                            let finalMsg;
                            //eslint-disable-next-line max-depth
                            if (cachedData && typeof cachedData === 'object') {
                                // Apply decoded message content onto cached metadata (preserves LID etc.)
                                cachedData.message = webMessageInfo.message;
                                //eslint-disable-next-line max-depth
                                if (webMessageInfo.messageTimestamp) {
                                    cachedData.messageTimestamp = webMessageInfo.messageTimestamp;
                                }
                                finalMsg = cachedData;
                            }
                            else {
                                finalMsg = webMessageInfo;
                            }
                            logger === null || logger === void 0 ? void 0 : logger.debug({ msgId, requestId: response.stanzaId }, 'received placeholder resend');
                            ev.emit('messages.upsert', {
                                messages: [finalMsg],
                                type: 'notify',
                                requestId: response.stanzaId
                            });
                        }
                        catch (err) {
                            logger === null || logger === void 0 ? void 0 : logger.warn({ err, stanzaId: response.stanzaId }, 'failed to decode placeholder resend response');
                        }
                    }
                }
                break;
            case proto.Message.ProtocolMessage.Type.MESSAGE_EDIT:
                ev.emit('messages.update', [
                    {
                        // flip the sender / fromMe properties because they're in the perspective of the sender
                        key: Object.assign(Object.assign({}, message.key), { id: (_g = protocolMsg.key) === null || _g === void 0 ? void 0 : _g.id }),
                        update: {
                            message: {
                                editedMessage: {
                                    message: protocolMsg.editedMessage
                                }
                            },
                            messageTimestamp: protocolMsg.timestampMs
                                ? Math.floor(toNumber(protocolMsg.timestampMs) / 1000)
                                : message.messageTimestamp
                        }
                    }
                ]);
                break;
            case proto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE:
                const labelAssociationMsg = protocolMsg.memberLabel;
                if (labelAssociationMsg === null || labelAssociationMsg === void 0 ? void 0 : labelAssociationMsg.label) {
                    ev.emit('group.member-tag.update', {
                        groupId: chat.id,
                        label: labelAssociationMsg.label,
                        participant: message.key.participant,
                        participantAlt: message.key.participantAlt,
                        messageTimestamp: Number(message.messageTimestamp)
                    });
                }
                break;
            case proto.Message.ProtocolMessage.Type.LID_MIGRATION_MAPPING_SYNC:
                const encodedPayload = (_h = protocolMsg.lidMigrationMappingSyncMessage) === null || _h === void 0 ? void 0 : _h.encodedMappingPayload;
                const { pnToLidMappings, chatDbMigrationTimestamp } = proto.LIDMigrationMappingSyncPayload.decode(encodedPayload);
                logger === null || logger === void 0 ? void 0 : logger.debug({ pnToLidMappings, chatDbMigrationTimestamp }, 'got lid mappings and chat db migration timestamp');
                const pairs = [];
                for (const { pn, latestLid, assignedLid } of pnToLidMappings) {
                    const lid = latestLid || assignedLid;
                    pairs.push({ lid: `${lid}@lid`, pn: `${pn}@s.whatsapp.net` });
                }
                yield signalRepository.lidMapping.storeLIDPNMappings(pairs);
                if (pairs.length) {
                    for (const { pn, lid } of pairs) {
                        yield signalRepository.migrateSession(pn, lid);
                    }
                }
        }
    }
    else if (content === null || content === void 0 ? void 0 : content.reactionMessage) {
        const reaction = Object.assign(Object.assign({}, content.reactionMessage), { key: message.key });
        ev.emit('messages.reaction', [
            {
                reaction,
                key: (_j = content.reactionMessage) === null || _j === void 0 ? void 0 : _j.key
            }
        ]);
    }
    else if (content === null || content === void 0 ? void 0 : content.encEventResponseMessage) {
        const encEventResponse = content.encEventResponseMessage;
        const creationMsgKey = encEventResponse.eventCreationMessageKey;
        // we need to fetch the event creation message to get the event enc key
        const eventMsg = yield getMessage(creationMsgKey);
        if (eventMsg) {
            try {
                const meIdNormalised = jidNormalizedUser(meId);
                // all jids need to be PN
                const eventCreatorKey = creationMsgKey.participant || creationMsgKey.remoteJid;
                const eventCreatorPn = isLidUser(eventCreatorKey)
                    ? yield signalRepository.lidMapping.getPNForLID(eventCreatorKey)
                    : eventCreatorKey;
                const eventCreatorJid = getKeyAuthor({ remoteJid: jidNormalizedUser(eventCreatorPn), fromMe: meIdNormalised === eventCreatorPn }, meIdNormalised);
                const responderJid = getKeyAuthor(message.key, meIdNormalised);
                const eventEncKey = (_k = eventMsg === null || eventMsg === void 0 ? void 0 : eventMsg.messageContextInfo) === null || _k === void 0 ? void 0 : _k.messageSecret;
                if (!eventEncKey) {
                    logger === null || logger === void 0 ? void 0 : logger.warn({ creationMsgKey }, 'event response: missing messageSecret for decryption');
                }
                else {
                    const responseMsg = decryptEventResponse(encEventResponse, {
                        eventEncKey,
                        eventCreatorJid,
                        eventMsgId: creationMsgKey.id,
                        responderJid
                    });
                    const eventResponse = {
                        eventResponseMessageKey: message.key,
                        senderTimestampMs: responseMsg.timestampMs,
                        response: responseMsg
                    };
                    ev.emit('messages.update', [
                        {
                            key: creationMsgKey,
                            update: {
                                eventResponses: [eventResponse]
                            }
                        }
                    ]);
                }
            }
            catch (err) {
                logger === null || logger === void 0 ? void 0 : logger.warn({ err, creationMsgKey }, 'failed to decrypt event response');
            }
        }
        else {
            logger === null || logger === void 0 ? void 0 : logger.warn({ creationMsgKey }, 'event creation message not found, cannot decrypt response');
        }
    }
    else if (message.messageStubType) {
        const jid = (_l = message.key) === null || _l === void 0 ? void 0 : _l.remoteJid;
        //let actor = whatsappID (message.participant)
        let participants;
        const emitParticipantsUpdate = (action) => ev.emit('group-participants.update', {
            id: jid,
            author: message.key.participant,
            authorPn: message.key.participantAlt,
            authorUsername: message.key.participantUsername,
            participants,
            action
        });
        const emitGroupUpdate = (update) => {
            var _a;
            ev.emit('groups.update', [
                Object.assign(Object.assign({ id: jid }, update), { author: (_a = message.key.participant) !== null && _a !== void 0 ? _a : undefined, authorPn: message.key.participantAlt, authorUsername: message.key.participantUsername })
            ]);
        };
        const emitGroupRequestJoin = (participant, action, method) => {
            ev.emit('group.join-request', {
                id: jid,
                author: message.key.participant,
                authorPn: message.key.participantAlt,
                authorUsername: message.key.participantUsername,
                participant: participant.lid,
                participantPn: participant.pn,
                action,
                method: method
            });
        };
        const participantsIncludesMe = () => participants.find(jid => areJidsSameUser(meId, jid.phoneNumber)); // ADD SUPPORT FOR LID
        switch (message.messageStubType) {
            case WAMessageStubType.GROUP_PARTICIPANT_CHANGE_NUMBER:
                participants = message.messageStubParameters.map((a) => JSON.parse(a)) || [];
                emitParticipantsUpdate('modify');
                break;
            case WAMessageStubType.GROUP_PARTICIPANT_LEAVE:
            case WAMessageStubType.GROUP_PARTICIPANT_REMOVE:
                participants = message.messageStubParameters.map((a) => JSON.parse(a)) || [];
                emitParticipantsUpdate('remove');
                // mark the chat read only if you left the group
                if (participantsIncludesMe()) {
                    chat.readOnly = true;
                }
                break;
            case WAMessageStubType.GROUP_PARTICIPANT_ADD:
            case WAMessageStubType.GROUP_PARTICIPANT_INVITE:
            case WAMessageStubType.GROUP_PARTICIPANT_ADD_REQUEST_JOIN:
                participants = message.messageStubParameters.map((a) => JSON.parse(a)) || [];
                if (participantsIncludesMe()) {
                    chat.readOnly = false;
                }
                emitParticipantsUpdate('add');
                break;
            case WAMessageStubType.GROUP_PARTICIPANT_DEMOTE:
                participants = message.messageStubParameters.map((a) => JSON.parse(a)) || [];
                emitParticipantsUpdate('demote');
                break;
            case WAMessageStubType.GROUP_PARTICIPANT_PROMOTE:
                participants = message.messageStubParameters.map((a) => JSON.parse(a)) || [];
                emitParticipantsUpdate('promote');
                break;
            case WAMessageStubType.GROUP_CHANGE_ANNOUNCE:
                const announceValue = (_m = message.messageStubParameters) === null || _m === void 0 ? void 0 : _m[0];
                emitGroupUpdate({ announce: announceValue === 'true' || announceValue === 'on' });
                break;
            case WAMessageStubType.GROUP_CHANGE_RESTRICT:
                const restrictValue = (_o = message.messageStubParameters) === null || _o === void 0 ? void 0 : _o[0];
                emitGroupUpdate({ restrict: restrictValue === 'true' || restrictValue === 'on' });
                break;
            case WAMessageStubType.GROUP_CHANGE_SUBJECT:
                const name = (_p = message.messageStubParameters) === null || _p === void 0 ? void 0 : _p[0];
                chat.name = name;
                emitGroupUpdate({ subject: name });
                break;
            case WAMessageStubType.GROUP_CHANGE_DESCRIPTION:
                const description = (_q = message.messageStubParameters) === null || _q === void 0 ? void 0 : _q[0];
                chat.description = description;
                emitGroupUpdate({ desc: description });
                break;
            case WAMessageStubType.GROUP_CHANGE_INVITE_LINK:
                const code = (_r = message.messageStubParameters) === null || _r === void 0 ? void 0 : _r[0];
                emitGroupUpdate({ inviteCode: code });
                break;
            case WAMessageStubType.GROUP_MEMBER_ADD_MODE:
                const memberAddValue = (_s = message.messageStubParameters) === null || _s === void 0 ? void 0 : _s[0];
                emitGroupUpdate({ memberAddMode: memberAddValue === 'all_member_add' });
                break;
            case WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE:
                const approvalMode = (_t = message.messageStubParameters) === null || _t === void 0 ? void 0 : _t[0];
                emitGroupUpdate({ joinApprovalMode: approvalMode === 'on' });
                break;
            case WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD: // TODO: Add other events
                const participant = JSON.parse((_u = message.messageStubParameters) === null || _u === void 0 ? void 0 : _u[0]);
                const action = (_v = message.messageStubParameters) === null || _v === void 0 ? void 0 : _v[1];
                const method = (_w = message.messageStubParameters) === null || _w === void 0 ? void 0 : _w[2];
                emitGroupRequestJoin(participant, action, method);
                break;
        }
    } /*  else if(content?.pollUpdateMessage) {
        const creationMsgKey = content.pollUpdateMessage.pollCreationMessageKey!
        // we need to fetch the poll creation message to get the poll enc key
        // TODO: make standalone, remove getMessage reference
        // TODO: Remove entirely
        const pollMsg = await getMessage(creationMsgKey)
        if(pollMsg) {
            const meIdNormalised = jidNormalizedUser(meId)
            const pollCreatorJid = getKeyAuthor(creationMsgKey, meIdNormalised)
            const voterJid = getKeyAuthor(message.key, meIdNormalised)
            const pollEncKey = pollMsg.messageContextInfo?.messageSecret!

            try {
                const voteMsg = decryptPollVote(
                    content.pollUpdateMessage.vote!,
                    {
                        pollEncKey,
                        pollCreatorJid,
                        pollMsgId: creationMsgKey.id!,
                        voterJid,
                    }
                )
                ev.emit('messages.update', [
                    {
                        key: creationMsgKey,
                        update: {
                            pollUpdates: [
                                {
                                    pollUpdateMessageKey: message.key,
                                    vote: voteMsg,
                                    senderTimestampMs: (content.pollUpdateMessage.senderTimestampMs! as Long).toNumber(),
                                }
                            ]
                        }
                    }
                ])
            } catch(err) {
                logger?.warn(
                    { err, creationMsgKey },
                    'failed to decrypt poll vote'
                )
            }
        } else {
            logger?.warn(
                { creationMsgKey },
                'poll creation message not found, cannot decrypt update'
            )
        }
        } */
    if (Object.keys(chat).length > 1) {
        ev.emit('chats.update', [chat]);
    }
});
export default processMessage;
