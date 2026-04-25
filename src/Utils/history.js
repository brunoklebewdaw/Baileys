var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createInflate, inflate } from 'zlib';
import { proto } from '../../WAProto/index.js';
import { WAMessageStubType } from '../Types';
import { isHostedLidUser, isHostedPnUser, isLidUser, isPnUser } from '../WABinary';
import { toNumber } from './generics';
import { normalizeMessageContent } from './messages';
import { downloadContentFromMessage } from './messages-media';
const inflatePromise = promisify(inflate);
const extractPnFromMessages = (messages) => {
    var _a, _b, _c;
    for (const msgItem of messages) {
        const message = msgItem.message;
        // Only extract from outgoing messages (fromMe: true) in 1:1 chats
        // because userReceipt.userJid is the recipient's JID
        if (!((_a = message === null || message === void 0 ? void 0 : message.key) === null || _a === void 0 ? void 0 : _a.fromMe) || !((_b = message.userReceipt) === null || _b === void 0 ? void 0 : _b.length)) {
            continue;
        }
        const userJid = (_c = message.userReceipt[0]) === null || _c === void 0 ? void 0 : _c.userJid;
        if (userJid && (isPnUser(userJid) || isHostedPnUser(userJid))) {
            return userJid;
        }
    }
    return undefined;
};
export const downloadHistory = (msg, options) => __awaiter(void 0, void 0, void 0, function* () {
    const stream = yield downloadContentFromMessage(msg, 'md-msg-hist', { options });
    // Pipe decrypted stream directly through zlib inflate
    // This avoids allocating an intermediate buffer for the compressed data
    const inflater = createInflate();
    const chunks = [];
    inflater.on('data', (chunk) => chunks.push(chunk));
    yield pipeline(stream, inflater);
    const buffer = Buffer.concat(chunks);
    const syncData = proto.HistorySync.decode(buffer);
    return syncData;
});
export const processHistoryMessage = (item, logger) => {
    var _a, _b, _c, _d;
    const messages = [];
    const contacts = [];
    const chats = [];
    const lidPnMappings = [];
    logger === null || logger === void 0 ? void 0 : logger.trace({ progress: item.progress }, 'processing history of type ' + ((_a = item.syncType) === null || _a === void 0 ? void 0 : _a.toString()));
    // Extract LID-PN mappings for all sync types
    for (const m of item.phoneNumberToLidMappings || []) {
        if (m.lidJid && m.pnJid) {
            lidPnMappings.push({ lid: m.lidJid, pn: m.pnJid });
        }
    }
    switch (item.syncType) {
        case proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP:
        case proto.HistorySync.HistorySyncType.RECENT:
        case proto.HistorySync.HistorySyncType.FULL:
        case proto.HistorySync.HistorySyncType.ON_DEMAND:
            for (const chat of item.conversations) {
                contacts.push({
                    id: chat.id,
                    name: chat.displayName || chat.name || chat.username || undefined,
                    username: chat.username || undefined,
                    lid: chat.lidJid || chat.accountLid || undefined,
                    phoneNumber: chat.pnJid || undefined
                });
                const chatId = chat.id;
                const isLid = isLidUser(chatId) || isHostedLidUser(chatId);
                const isPn = isPnUser(chatId) || isHostedPnUser(chatId);
                if (isLid && chat.pnJid) {
                    lidPnMappings.push({ lid: chatId, pn: chat.pnJid });
                }
                else if (isPn && chat.lidJid) {
                    lidPnMappings.push({ lid: chat.lidJid, pn: chatId });
                }
                else if (isLid && !chat.pnJid) {
                    // Fallback: extract PN from userReceipt in messages when pnJid is missing
                    const pnFromReceipt = extractPnFromMessages(chat.messages || []);
                    if (pnFromReceipt) {
                        lidPnMappings.push({ lid: chatId, pn: pnFromReceipt });
                    }
                }
                const msgs = chat.messages || [];
                delete chat.messages;
                for (const item of msgs) {
                    const message = item.message;
                    messages.push(message);
                    if (!((_b = chat.messages) === null || _b === void 0 ? void 0 : _b.length)) {
                        // keep only the most recent message in the chat array
                        chat.messages = [{ message }];
                    }
                    if (!message.key.fromMe && !chat.lastMessageRecvTimestamp) {
                        chat.lastMessageRecvTimestamp = toNumber(message.messageTimestamp);
                    }
                    if ((message.messageStubType === WAMessageStubType.BIZ_PRIVACY_MODE_TO_BSP ||
                        message.messageStubType === WAMessageStubType.BIZ_PRIVACY_MODE_TO_FB) &&
                        ((_c = message.messageStubParameters) === null || _c === void 0 ? void 0 : _c[0])) {
                        contacts.push({
                            id: message.key.participant || message.key.remoteJid,
                            verifiedName: (_d = message.messageStubParameters) === null || _d === void 0 ? void 0 : _d[0]
                        });
                    }
                }
                chats.push(chat);
            }
            break;
        case proto.HistorySync.HistorySyncType.PUSH_NAME:
            for (const c of item.pushnames) {
                contacts.push({ id: c.id, notify: c.pushname });
            }
            break;
    }
    return {
        chats,
        contacts,
        messages,
        lidPnMappings,
        syncType: item.syncType,
        progress: item.progress
    };
};
export const downloadAndProcessHistorySyncNotification = (msg, options, logger) => __awaiter(void 0, void 0, void 0, function* () {
    let historyMsg;
    if (msg.initialHistBootstrapInlinePayload) {
        historyMsg = proto.HistorySync.decode(yield inflatePromise(msg.initialHistBootstrapInlinePayload));
    }
    else {
        historyMsg = yield downloadHistory(msg, options);
    }
    return processHistoryMessage(historyMsg, logger);
});
export const getHistoryMsg = (message) => {
    var _a;
    const normalizedContent = !!message ? normalizeMessageContent(message) : undefined;
    const anyHistoryMsg = (_a = normalizedContent === null || normalizedContent === void 0 ? void 0 : normalizedContent.protocolMessage) === null || _a === void 0 ? void 0 : _a.historySyncNotification;
    return anyHistoryMsg;
};
