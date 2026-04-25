var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import NodeCache from '@cacheable/node-cache';
import { Boom } from '@hapi/boom';
import { proto } from '../../WAProto/index.js';
import { DEFAULT_CACHE_TTLS, HISTORY_SYNC_PAUSED_TIMEOUT_MS, PROCESSABLE_HISTORY_TYPES } from '../Defaults';
import { ALL_WA_PATCH_NAMES } from '../Types';
import { SyncState } from '../Types/State';
import { chatModificationToAppPatch, decodePatches, decodeSyncdSnapshot, encodeSyncdPatch, ensureLTHashStateVersion, extractSyncdPatches, generateProfilePicture, getHistoryMsg, isAppStateSyncIrrecoverable, isMissingKeyError, MAX_SYNC_ATTEMPTS, newLTHashState, processSyncAction } from '../Utils';
import { makeMutex } from '../Utils/make-mutex';
import processMessage from '../Utils/process-message';
import { buildTcTokenFromJid } from '../Utils/tc-token-utils';
import { getBinaryNodeChild, getBinaryNodeChildren, isLidUser, isPnUser, jidDecode, jidNormalizedUser, isHostedLidUser, isHostedPnUser, reduceBinaryNodeToDictionary, S_WHATSAPP_NET } from '../WABinary';
import { USyncQuery, USyncUser } from '../WAUSync';
import { makeSocket } from './socket.js';
export const makeChatsSocket = (config) => {
    const { logger, markOnlineOnConnect, fireInitQueries, appStateMacVerification, shouldIgnoreJid, shouldSyncHistoryMessage, getMessage } = config;
    const sock = makeSocket(config);
    const { ev, ws, authState, generateMessageTag, sendNode, query, signalRepository, onUnexpectedError, sendUnifiedSession } = sock;
    const getLIDForPN = signalRepository.lidMapping.getLIDForPN.bind(signalRepository.lidMapping);
    let privacySettings;
    /** Server-assigned AB props for protocol behavior. */
    const serverProps = {
        /** AB prop 10518: gate tctoken on 1:1 messages. Default true (safe: avoids 463). */
        privacyTokenOn1to1: true,
        /** AB prop 9666: gate tctoken on profile picture IQs. WA Web default: true. */
        profilePicPrivacyToken: true,
        /** AB prop 14303: issue tctokens to LID instead of PN. WA Web default: false. */
        lidTrustedTokenIssueToLid: false
    };
    let syncState = SyncState.Connecting;
    /** this mutex ensures that messages are processed in order */
    const messageMutex = makeMutex();
    /** this mutex ensures that receipts are processed in order */
    const receiptMutex = makeMutex();
    /** this mutex ensures that app state patches are processed in order */
    const appStatePatchMutex = makeMutex();
    /** this mutex ensures that notifications are processed in order */
    const notificationMutex = makeMutex();
    // Timeout for AwaitingInitialSync state
    let awaitingSyncTimeout;
    // In-memory history sync completion tracking (resets on reconnection)
    const historySyncStatus = {
        initialBootstrapComplete: false,
        recentSyncComplete: false
    };
    let historySyncPausedTimeout;
    // Collections blocked on missing app state sync keys (mirrors WA Web's "Blocked" state).
    // When a key arrives via APP_STATE_SYNC_KEY_SHARE, these are re-synced.
    const blockedCollections = new Set();
    const placeholderResendCache = config.placeholderResendCache ||
        new NodeCache({
            stdTTL: DEFAULT_CACHE_TTLS.MSG_RETRY, // 1 hour
            useClones: false
        });
    if (!config.placeholderResendCache) {
        config.placeholderResendCache = placeholderResendCache;
    }
    /** helper function to fetch the given app state sync key */
    const getAppStateSyncKey = (keyId) => __awaiter(void 0, void 0, void 0, function* () {
        const { [keyId]: key } = yield authState.keys.get('app-state-sync-key', [keyId]);
        return key;
    });
    const fetchPrivacySettings = (...args_1) => __awaiter(void 0, [...args_1], void 0, function* (force = false) {
        if (!privacySettings || force) {
            const { content } = yield query({
                tag: 'iq',
                attrs: {
                    xmlns: 'privacy',
                    to: S_WHATSAPP_NET,
                    type: 'get'
                },
                content: [{ tag: 'privacy', attrs: {} }]
            });
            privacySettings = reduceBinaryNodeToDictionary(content === null || content === void 0 ? void 0 : content[0], 'category');
        }
        return privacySettings;
    });
    /** helper function to run a privacy IQ query */
    const privacyQuery = (name, value) => __awaiter(void 0, void 0, void 0, function* () {
        yield query({
            tag: 'iq',
            attrs: {
                xmlns: 'privacy',
                to: S_WHATSAPP_NET,
                type: 'set'
            },
            content: [
                {
                    tag: 'privacy',
                    attrs: {},
                    content: [
                        {
                            tag: 'category',
                            attrs: { name, value }
                        }
                    ]
                }
            ]
        });
    });
    const updateMessagesPrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('messages', value);
    });
    const updateCallPrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('calladd', value);
    });
    const updateLastSeenPrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('last', value);
    });
    const updateOnlinePrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('online', value);
    });
    const updateProfilePicturePrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('profile', value);
    });
    const updateStatusPrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('status', value);
    });
    const updateReadReceiptsPrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('readreceipts', value);
    });
    const updateGroupsAddPrivacy = (value) => __awaiter(void 0, void 0, void 0, function* () {
        yield privacyQuery('groupadd', value);
    });
    const updateDefaultDisappearingMode = (duration) => __awaiter(void 0, void 0, void 0, function* () {
        yield query({
            tag: 'iq',
            attrs: {
                xmlns: 'disappearing_mode',
                to: S_WHATSAPP_NET,
                type: 'set'
            },
            content: [
                {
                    tag: 'disappearing_mode',
                    attrs: {
                        duration: duration.toString()
                    }
                }
            ]
        });
    });
    const getBotListV2 = () => __awaiter(void 0, void 0, void 0, function* () {
        const resp = yield query({
            tag: 'iq',
            attrs: {
                xmlns: 'bot',
                to: S_WHATSAPP_NET,
                type: 'get'
            },
            content: [
                {
                    tag: 'bot',
                    attrs: {
                        v: '2'
                    }
                }
            ]
        });
        const botNode = getBinaryNodeChild(resp, 'bot');
        const botList = [];
        for (const section of getBinaryNodeChildren(botNode, 'section')) {
            if (section.attrs.type === 'all') {
                for (const bot of getBinaryNodeChildren(section, 'bot')) {
                    botList.push({
                        jid: bot.attrs.jid,
                        personaId: bot.attrs['persona_id']
                    });
                }
            }
        }
        return botList;
    });
    const fetchStatus = (...jids) => __awaiter(void 0, void 0, void 0, function* () {
        const usyncQuery = new USyncQuery().withStatusProtocol();
        for (const jid of jids) {
            usyncQuery.withUser(new USyncUser().withId(jid));
        }
        const result = yield sock.executeUSyncQuery(usyncQuery);
        if (result) {
            return result.list;
        }
    });
    const fetchDisappearingDuration = (...jids) => __awaiter(void 0, void 0, void 0, function* () {
        const usyncQuery = new USyncQuery().withDisappearingModeProtocol();
        for (const jid of jids) {
            usyncQuery.withUser(new USyncUser().withId(jid));
        }
        const result = yield sock.executeUSyncQuery(usyncQuery);
        if (result) {
            return result.list;
        }
    });
    /** update the profile picture for yourself or a group */
    const updateProfilePicture = (jid, content, dimensions) => __awaiter(void 0, void 0, void 0, function* () {
        let targetJid;
        if (!jid) {
            throw new Boom('Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update');
        }
        if (jidNormalizedUser(jid) !== jidNormalizedUser(authState.creds.me.id)) {
            targetJid = jidNormalizedUser(jid); // in case it is someone other than us
        }
        else {
            targetJid = undefined;
        }
        const { img } = yield generateProfilePicture(content, dimensions);
        yield query({
            tag: 'iq',
            attrs: Object.assign({ to: S_WHATSAPP_NET, type: 'set', xmlns: 'w:profile:picture' }, (targetJid ? { target: targetJid } : {})),
            content: [
                {
                    tag: 'picture',
                    attrs: { type: 'image' },
                    content: img
                }
            ]
        });
    });
    /** remove the profile picture for yourself or a group */
    const removeProfilePicture = (jid) => __awaiter(void 0, void 0, void 0, function* () {
        let targetJid;
        if (!jid) {
            throw new Boom('Illegal no-jid profile update. Please specify either your ID or the ID of the chat you wish to update');
        }
        if (jidNormalizedUser(jid) !== jidNormalizedUser(authState.creds.me.id)) {
            targetJid = jidNormalizedUser(jid); // in case it is someone other than us
        }
        else {
            targetJid = undefined;
        }
        yield query({
            tag: 'iq',
            attrs: Object.assign({ to: S_WHATSAPP_NET, type: 'set', xmlns: 'w:profile:picture' }, (targetJid ? { target: targetJid } : {}))
        });
    });
    /** update the profile status for yourself */
    const updateProfileStatus = (status) => __awaiter(void 0, void 0, void 0, function* () {
        yield query({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'status'
            },
            content: [
                {
                    tag: 'status',
                    attrs: {},
                    content: Buffer.from(status, 'utf-8')
                }
            ]
        });
    });
    const updateProfileName = (name) => __awaiter(void 0, void 0, void 0, function* () {
        yield chatModify({ pushNameSetting: name }, '');
    });
    const fetchBlocklist = () => __awaiter(void 0, void 0, void 0, function* () {
        const result = yield query({
            tag: 'iq',
            attrs: {
                xmlns: 'blocklist',
                to: S_WHATSAPP_NET,
                type: 'get'
            }
        });
        const listNode = getBinaryNodeChild(result, 'list');
        return getBinaryNodeChildren(listNode, 'item').map(n => n.attrs.jid);
    });
    const updateBlockStatus = (jid, action) => __awaiter(void 0, void 0, void 0, function* () {
        const normalizedJid = jidNormalizedUser(jid);
        let lid;
        let pn_jid;
        if (isLidUser(normalizedJid) || isHostedLidUser(normalizedJid)) {
            lid = normalizedJid;
            if (action === 'block') {
                const pn = yield signalRepository.lidMapping.getPNForLID(normalizedJid);
                if (!pn) {
                    throw new Boom(`Unable to resolve PN JID for LID: ${jid}`, { statusCode: 400 });
                }
                pn_jid = jidNormalizedUser(pn);
            }
        }
        else if (isPnUser(normalizedJid) || isHostedPnUser(normalizedJid)) {
            const mapped = yield signalRepository.lidMapping.getLIDForPN(normalizedJid);
            if (!mapped) {
                throw new Boom(`Unable to resolve LID for PN JID: ${jid}`, { statusCode: 400 });
            }
            lid = mapped;
            if (action === 'block') {
                pn_jid = jidNormalizedUser(normalizedJid);
            }
        }
        else {
            throw new Boom(`Invalid jid: ${jid}`, { statusCode: 400 });
        }
        const itemAttrs = {
            action,
            jid: lid
        };
        if (action === 'block') {
            if (!pn_jid) {
                throw new Boom(`pn_jid required for block: ${jid}`, { statusCode: 400 });
            }
            itemAttrs.pn_jid = pn_jid;
        }
        yield query({
            tag: 'iq',
            attrs: {
                xmlns: 'blocklist',
                to: S_WHATSAPP_NET,
                type: 'set'
            },
            content: [
                {
                    tag: 'item',
                    attrs: itemAttrs
                }
            ]
        });
    });
    const getBusinessProfile = (jid) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const results = yield query({
            tag: 'iq',
            attrs: {
                to: 's.whatsapp.net',
                xmlns: 'w:biz',
                type: 'get'
            },
            content: [
                {
                    tag: 'business_profile',
                    attrs: { v: '244' },
                    content: [
                        {
                            tag: 'profile',
                            attrs: { jid }
                        }
                    ]
                }
            ]
        });
        const profileNode = getBinaryNodeChild(results, 'business_profile');
        const profiles = getBinaryNodeChild(profileNode, 'profile');
        if (profiles) {
            const address = getBinaryNodeChild(profiles, 'address');
            const description = getBinaryNodeChild(profiles, 'description');
            const website = getBinaryNodeChild(profiles, 'website');
            const email = getBinaryNodeChild(profiles, 'email');
            const category = getBinaryNodeChild(getBinaryNodeChild(profiles, 'categories'), 'category');
            const businessHours = getBinaryNodeChild(profiles, 'business_hours');
            const businessHoursConfig = businessHours
                ? getBinaryNodeChildren(businessHours, 'business_hours_config')
                : undefined;
            const websiteStr = (_a = website === null || website === void 0 ? void 0 : website.content) === null || _a === void 0 ? void 0 : _a.toString();
            return {
                wid: (_b = profiles.attrs) === null || _b === void 0 ? void 0 : _b.jid,
                address: (_c = address === null || address === void 0 ? void 0 : address.content) === null || _c === void 0 ? void 0 : _c.toString(),
                description: ((_d = description === null || description === void 0 ? void 0 : description.content) === null || _d === void 0 ? void 0 : _d.toString()) || '',
                website: websiteStr ? [websiteStr] : [],
                email: (_e = email === null || email === void 0 ? void 0 : email.content) === null || _e === void 0 ? void 0 : _e.toString(),
                category: (_f = category === null || category === void 0 ? void 0 : category.content) === null || _f === void 0 ? void 0 : _f.toString(),
                business_hours: {
                    timezone: (_g = businessHours === null || businessHours === void 0 ? void 0 : businessHours.attrs) === null || _g === void 0 ? void 0 : _g.timezone,
                    business_config: businessHoursConfig === null || businessHoursConfig === void 0 ? void 0 : businessHoursConfig.map(({ attrs }) => attrs)
                }
            };
        }
    });
    const cleanDirtyBits = (type, fromTimestamp) => __awaiter(void 0, void 0, void 0, function* () {
        logger.info({ fromTimestamp }, 'clean dirty bits ' + type);
        yield sendNode({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'urn:xmpp:whatsapp:dirty',
                id: generateMessageTag()
            },
            content: [
                {
                    tag: 'clean',
                    attrs: Object.assign({ type }, (fromTimestamp ? { timestamp: fromTimestamp.toString() } : null))
                }
            ]
        });
    });
    const newAppStateChunkHandler = (isInitialSync) => {
        return {
            onMutation(mutation) {
                processSyncAction(mutation, ev, authState.creds.me, isInitialSync ? { accountSettings: authState.creds.accountSettings } : undefined, logger);
            }
        };
    };
    const resyncAppState = ev.createBufferedFunction((collections, isInitialSync) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const appStateSyncKeyCache = new Map();
        const getCachedAppStateSyncKey = (keyId) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            if (appStateSyncKeyCache.has(keyId)) {
                return (_a = appStateSyncKeyCache.get(keyId)) !== null && _a !== void 0 ? _a : undefined;
            }
            const key = yield getAppStateSyncKey(keyId);
            appStateSyncKeyCache.set(keyId, key !== null && key !== void 0 ? key : null);
            return key;
        });
        // we use this to determine which events to fire
        // otherwise when we resync from scratch -- all notifications will fire
        const initialVersionMap = {};
        const globalMutationMap = {};
        yield authState.keys.transaction(() => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const collectionsToHandle = new Set(collections);
            // in case something goes wrong -- ensure we don't enter a loop that cannot be exited from
            const attemptsMap = {};
            // collections that failed and need a full snapshot on retry
            // mirrors WA Web's ErrorFatal -> force snapshot behavior
            const forceSnapshotCollections = new Set();
            // keep executing till all collections are done
            // sometimes a single patch request will not return all the patches (God knows why)
            // so we fetch till they're all done (this is determined by the "has_more_patches" flag)
            while (collectionsToHandle.size) {
                const states = {};
                const nodes = [];
                for (const name of collectionsToHandle) {
                    const result = yield authState.keys.get('app-state-sync-version', [name]);
                    let state = result[name];
                    if (state) {
                        state = ensureLTHashStateVersion(state);
                        if (typeof initialVersionMap[name] === 'undefined') {
                            initialVersionMap[name] = state.version;
                        }
                    }
                    else {
                        state = newLTHashState();
                    }
                    states[name] = state;
                    const shouldForceSnapshot = forceSnapshotCollections.has(name);
                    if (shouldForceSnapshot) {
                        forceSnapshotCollections.delete(name);
                    }
                    logger.info(`resyncing ${name} from v${state.version}${shouldForceSnapshot ? ' (forcing snapshot)' : ''}`);
                    nodes.push({
                        tag: 'collection',
                        attrs: {
                            name,
                            version: state.version.toString(),
                            // return snapshot if syncing from scratch or forcing after a failed attempt
                            return_snapshot: (shouldForceSnapshot || !state.version).toString()
                        }
                    });
                }
                const result = yield query({
                    tag: 'iq',
                    attrs: {
                        to: S_WHATSAPP_NET,
                        xmlns: 'w:sync:app:state',
                        type: 'set'
                    },
                    content: [
                        {
                            tag: 'sync',
                            attrs: {},
                            content: nodes
                        }
                    ]
                });
                // extract from binary node
                const decoded = yield extractSyncdPatches(result, config === null || config === void 0 ? void 0 : config.options);
                for (const key in decoded) {
                    const name = key;
                    const { patches, hasMorePatches, snapshot } = decoded[name];
                    try {
                        if (snapshot) {
                            const { state: newState, mutationMap } = yield decodeSyncdSnapshot(name, snapshot, getCachedAppStateSyncKey, initialVersionMap[name], appStateMacVerification.snapshot);
                            states[name] = newState;
                            Object.assign(globalMutationMap, mutationMap);
                            logger.info(`restored state of ${name} from snapshot to v${newState.version} with mutations`);
                            yield authState.keys.set({ 'app-state-sync-version': { [name]: newState } });
                        }
                        // only process if there are syncd patches
                        if (patches.length) {
                            const { state: newState, mutationMap } = yield decodePatches(name, patches, states[name], getCachedAppStateSyncKey, config.options, initialVersionMap[name], logger, appStateMacVerification.patch);
                            yield authState.keys.set({ 'app-state-sync-version': { [name]: newState } });
                            logger.info(`synced ${name} to v${newState.version}`);
                            initialVersionMap[name] = newState.version;
                            Object.assign(globalMutationMap, mutationMap);
                        }
                        if (hasMorePatches) {
                            logger.info(`${name} has more patches...`);
                        }
                        else {
                            // collection is done with sync
                            collectionsToHandle.delete(name);
                        }
                    }
                    catch (error) {
                        attemptsMap[name] = (attemptsMap[name] || 0) + 1;
                        const logData = {
                            name,
                            attempt: attemptsMap[name],
                            version: states[name].version,
                            statusCode: (_a = error.output) === null || _a === void 0 ? void 0 : _a.statusCode,
                            errorType: error.name,
                            error: error.stack
                        };
                        if (isMissingKeyError(error) && attemptsMap[name] >= MAX_SYNC_ATTEMPTS) {
                            // WA Web treats missing keys as "Blocked" — park the collection
                            // until the key arrives via APP_STATE_SYNC_KEY_SHARE.
                            logger.warn(logData, `${name} blocked on missing key from v${states[name].version}, parking after ${attemptsMap[name]} attempts`);
                            blockedCollections.add(name);
                            collectionsToHandle.delete(name);
                        }
                        else if (isMissingKeyError(error)) {
                            // Retry with a snapshot which may use a different key.
                            logger.info(logData, `${name} blocked on missing key from v${states[name].version}, retrying with snapshot`);
                            forceSnapshotCollections.add(name);
                        }
                        else if (isAppStateSyncIrrecoverable(error, attemptsMap[name])) {
                            logger.warn(logData, `failed to sync ${name} from v${states[name].version}, giving up`);
                            collectionsToHandle.delete(name);
                        }
                        else {
                            logger.info(logData, `failed to sync ${name} from v${states[name].version}, forcing snapshot retry`);
                            // force a full snapshot on retry to recover from
                            // corrupted local state (e.g. LTHash MAC mismatch)
                            forceSnapshotCollections.add(name);
                        }
                    }
                }
            }
        }), ((_b = (_a = authState === null || authState === void 0 ? void 0 : authState.creds) === null || _a === void 0 ? void 0 : _a.me) === null || _b === void 0 ? void 0 : _b.id) || 'resync-app-state');
        const { onMutation } = newAppStateChunkHandler(isInitialSync);
        for (const key in globalMutationMap) {
            onMutation(globalMutationMap[key]);
        }
    }));
    /**
     * fetch the profile picture of a user/group
     * type = "preview" for a low res picture
     * type = "image for the high res picture"
     */
    const profilePictureUrl = (jid_1, ...args_1) => __awaiter(void 0, [jid_1, ...args_1], void 0, function* (jid, type = 'preview', timeoutMs) {
        var _a;
        const baseContent = [{ tag: 'picture', attrs: { type, query: 'url' } }];
        // WA Web only includes tctoken for user JIDs (not groups/newsletters)
        // and never for own profile pic (Chat model for self has no tcToken).
        // Including tctoken for own JID causes the server to never respond.
        const normalizedJid = jidNormalizedUser(jid);
        const isUserJid = isPnUser(normalizedJid) || isLidUser(normalizedJid);
        const me = authState.creds.me;
        const isSelf = me && (normalizedJid === jidNormalizedUser(me.id) || (me.lid && normalizedJid === jidNormalizedUser(me.lid)));
        let content = baseContent;
        if (serverProps.profilePicPrivacyToken && isUserJid && !isSelf) {
            content = yield buildTcTokenFromJid({
                authState,
                jid: normalizedJid,
                baseContent,
                getLIDForPN
            });
        }
        jid = jidNormalizedUser(jid);
        const result = yield query({
            tag: 'iq',
            attrs: {
                target: jid,
                to: S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'w:profile:picture'
            },
            content
        }, timeoutMs);
        const child = getBinaryNodeChild(result, 'picture');
        return (_a = child === null || child === void 0 ? void 0 : child.attrs) === null || _a === void 0 ? void 0 : _a.url;
    });
    const createCallLink = (type, event, timeoutMs) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const result = yield query({
            tag: 'call',
            attrs: {
                id: generateMessageTag(),
                to: '@call'
            },
            content: [
                {
                    tag: 'link_create',
                    attrs: { media: type },
                    content: event ? [{ tag: 'event', attrs: { start_time: String(event.startTime) } }] : undefined
                }
            ]
        }, timeoutMs);
        const child = getBinaryNodeChild(result, 'link_create');
        return (_a = child === null || child === void 0 ? void 0 : child.attrs) === null || _a === void 0 ? void 0 : _a.token;
    });
    const sendPresenceUpdate = (type, toJid) => __awaiter(void 0, void 0, void 0, function* () {
        const me = authState.creds.me;
        const isAvailableType = type === 'available';
        if (isAvailableType || type === 'unavailable') {
            if (!me.name) {
                logger.warn('no name present, ignoring presence update request...');
                return;
            }
            ev.emit('connection.update', { isOnline: isAvailableType });
            if (isAvailableType) {
                void sendUnifiedSession();
            }
            yield sendNode({
                tag: 'presence',
                attrs: {
                    name: me.name.replace(/@/g, ''),
                    type
                }
            });
        }
        else {
            const { server } = jidDecode(toJid);
            const isLid = server === 'lid';
            yield sendNode({
                tag: 'chatstate',
                attrs: {
                    from: isLid ? me.lid : me.id,
                    to: toJid
                },
                content: [
                    {
                        tag: type === 'recording' ? 'composing' : type,
                        attrs: type === 'recording' ? { media: 'audio' } : {}
                    }
                ]
            });
        }
    });
    /**
     * @param toJid the jid to subscribe to
     * @param tcToken token for subscription, use if present
     */
    const presenceSubscribe = (toJid) => __awaiter(void 0, void 0, void 0, function* () {
        // Only include tctoken for user JIDs — groups/newsletters don't use tctokens
        const normalizedToJid = jidNormalizedUser(toJid);
        const isUserJid = isPnUser(normalizedToJid) || isLidUser(normalizedToJid);
        const tcTokenContent = isUserJid
            ? yield buildTcTokenFromJid({ authState, jid: normalizedToJid, getLIDForPN })
            : undefined;
        return sendNode({
            tag: 'presence',
            attrs: {
                to: toJid,
                id: generateMessageTag(),
                type: 'subscribe'
            },
            content: tcTokenContent
        });
    });
    const handlePresenceUpdate = ({ tag, attrs, content }) => {
        var _a;
        let presence;
        const jid = attrs.from;
        const participant = attrs.participant || attrs.from;
        if (shouldIgnoreJid(jid) && jid !== S_WHATSAPP_NET) {
            return;
        }
        if (tag === 'presence') {
            presence = {
                lastKnownPresence: attrs.type === 'unavailable' ? 'unavailable' : 'available',
                lastSeen: attrs.last && attrs.last !== 'deny' ? +attrs.last : undefined
            };
        }
        else if (Array.isArray(content)) {
            const [firstChild] = content;
            let type = firstChild.tag;
            if (type === 'paused') {
                type = 'available';
            }
            if (((_a = firstChild.attrs) === null || _a === void 0 ? void 0 : _a.media) === 'audio') {
                type = 'recording';
            }
            presence = { lastKnownPresence: type };
        }
        else {
            logger.error({ tag, attrs, content }, 'recv invalid presence node');
        }
        if (presence) {
            ev.emit('presence.update', { id: jid, presences: { [participant]: presence } });
        }
    };
    const appPatch = (patchCreate) => __awaiter(void 0, void 0, void 0, function* () {
        const name = patchCreate.type;
        const myAppStateKeyId = authState.creds.myAppStateKeyId;
        if (!myAppStateKeyId) {
            throw new Boom('App state key not present!', { statusCode: 400 });
        }
        let initial;
        let encodeResult;
        yield appStatePatchMutex.mutex(() => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            yield authState.keys.transaction(() => __awaiter(void 0, void 0, void 0, function* () {
                logger.debug({ patch: patchCreate }, 'applying app patch');
                yield resyncAppState([name], false);
                const { [name]: currentSyncVersion } = yield authState.keys.get('app-state-sync-version', [name]);
                initial = currentSyncVersion ? ensureLTHashStateVersion(currentSyncVersion) : newLTHashState();
                encodeResult = yield encodeSyncdPatch(patchCreate, myAppStateKeyId, initial, getAppStateSyncKey);
                const { patch, state } = encodeResult;
                const node = {
                    tag: 'iq',
                    attrs: {
                        to: S_WHATSAPP_NET,
                        type: 'set',
                        xmlns: 'w:sync:app:state'
                    },
                    content: [
                        {
                            tag: 'sync',
                            attrs: {},
                            content: [
                                {
                                    tag: 'collection',
                                    attrs: {
                                        name,
                                        version: (state.version - 1).toString(),
                                        return_snapshot: 'false'
                                    },
                                    content: [
                                        {
                                            tag: 'patch',
                                            attrs: {},
                                            content: proto.SyncdPatch.encode(patch).finish()
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                };
                yield query(node);
                yield authState.keys.set({ 'app-state-sync-version': { [name]: state } });
            }), ((_b = (_a = authState === null || authState === void 0 ? void 0 : authState.creds) === null || _a === void 0 ? void 0 : _a.me) === null || _b === void 0 ? void 0 : _b.id) || 'app-patch');
        }));
        if (config.emitOwnEvents) {
            const { onMutation } = newAppStateChunkHandler(false);
            const { mutationMap } = yield decodePatches(name, [Object.assign(Object.assign({}, encodeResult.patch), { version: { version: encodeResult.state.version } })], initial, getAppStateSyncKey, config.options, undefined, logger);
            for (const key in mutationMap) {
                onMutation(mutationMap[key]);
            }
        }
    });
    /** fetch AB props */
    const fetchProps = () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const resultNode = yield query({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                xmlns: 'abt',
                type: 'get'
            },
            content: [
                {
                    tag: 'props',
                    attrs: Object.assign({ protocol: '1' }, (((_a = authState === null || authState === void 0 ? void 0 : authState.creds) === null || _a === void 0 ? void 0 : _a.lastPropHash) ? { hash: authState.creds.lastPropHash } : {}))
                }
            ]
        });
        const propsNode = getBinaryNodeChild(resultNode, 'props');
        let props = {};
        if (propsNode) {
            if ((_b = propsNode.attrs) === null || _b === void 0 ? void 0 : _b.hash) {
                // on some clients, the hash is returning as undefined
                authState.creds.lastPropHash = (_c = propsNode === null || propsNode === void 0 ? void 0 : propsNode.attrs) === null || _c === void 0 ? void 0 : _c.hash;
                ev.emit('creds.update', authState.creds);
            }
            props = reduceBinaryNodeToDictionary(propsNode, 'prop');
        }
        // Extract protocol-relevant AB props (only the ones we need)
        const privacyTokenProp = (_d = props['10518']) !== null && _d !== void 0 ? _d : props['privacy_token_sending_on_all_1_on_1_messages'];
        if (privacyTokenProp !== undefined) {
            serverProps.privacyTokenOn1to1 = privacyTokenProp === 'true' || privacyTokenProp === '1';
        }
        const profilePicProp = (_e = props['9666']) !== null && _e !== void 0 ? _e : props['profile_scraping_privacy_token_in_photo_iq'];
        if (profilePicProp !== undefined) {
            serverProps.profilePicPrivacyToken = profilePicProp === 'true' || profilePicProp === '1';
        }
        const lidIssueProp = (_f = props['14303']) !== null && _f !== void 0 ? _f : props['lid_trusted_token_issue_to_lid'];
        if (lidIssueProp !== undefined) {
            serverProps.lidTrustedTokenIssueToLid = lidIssueProp === 'true' || lidIssueProp === '1';
        }
        logger.debug({ serverProps }, 'fetched props');
        return props;
    });
    /**
     * modify a chat -- mark unread, read etc.
     * lastMessages must be sorted in reverse chronologically
     * requires the last messages till the last message received; required for archive & unread
     */
    const chatModify = (mod, jid) => {
        const patch = chatModificationToAppPatch(mod, jid);
        return appPatch(patch);
    };
    /**
     * Enable/Disable link preview privacy, not related to baileys link preview generation
     */
    const updateDisableLinkPreviewsPrivacy = (isPreviewsDisabled) => {
        return chatModify({
            disableLinkPreviews: { isPreviewsDisabled }
        }, '');
    };
    /**
     * Star or Unstar a message
     */
    const star = (jid, messages, star) => {
        return chatModify({
            star: {
                messages,
                star
            }
        }, jid);
    };
    /**
     * Add or Edit Contact
     */
    const addOrEditContact = (jid, contact) => {
        return chatModify({
            contact
        }, jid);
    };
    /**
     * Remove Contact
     */
    const removeContact = (jid) => {
        return chatModify({
            contact: null
        }, jid);
    };
    /**
     * Adds label
     */
    const addLabel = (jid, labels) => {
        return chatModify({
            addLabel: Object.assign({}, labels)
        }, jid);
    };
    /**
     * Adds label for the chats
     */
    const addChatLabel = (jid, labelId) => {
        return chatModify({
            addChatLabel: {
                labelId
            }
        }, jid);
    };
    /**
     * Removes label for the chat
     */
    const removeChatLabel = (jid, labelId) => {
        return chatModify({
            removeChatLabel: {
                labelId
            }
        }, jid);
    };
    /**
     * Adds label for the message
     */
    const addMessageLabel = (jid, messageId, labelId) => {
        return chatModify({
            addMessageLabel: {
                messageId,
                labelId
            }
        }, jid);
    };
    /**
     * Removes label for the message
     */
    const removeMessageLabel = (jid, messageId, labelId) => {
        return chatModify({
            removeMessageLabel: {
                messageId,
                labelId
            }
        }, jid);
    };
    /**
     * Add or Edit Quick Reply
     */
    const addOrEditQuickReply = (quickReply) => {
        return chatModify({
            quickReply
        }, '');
    };
    /**
     * Remove Quick Reply
     */
    const removeQuickReply = (timestamp) => {
        return chatModify({
            quickReply: { timestamp, deleted: true }
        }, '');
    };
    /**
     * queries need to be fired on connection open
     * help ensure parity with WA Web
     * */
    const executeInitQueries = () => __awaiter(void 0, void 0, void 0, function* () {
        yield Promise.all([fetchProps(), fetchBlocklist(), fetchPrivacySettings()]);
    });
    const upsertMessage = ev.createBufferedFunction((msg, type) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        ev.emit('messages.upsert', { messages: [msg], type });
        if (!!msg.pushName) {
            let jid = msg.key.fromMe ? authState.creds.me.id : msg.key.participant || msg.key.remoteJid;
            jid = jidNormalizedUser(jid);
            if (!msg.key.fromMe) {
                ev.emit('contacts.update', [{ id: jid, notify: msg.pushName, verifiedName: msg.verifiedBizName }]);
            }
            // update our pushname too
            if (msg.key.fromMe && msg.pushName && ((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.name) !== msg.pushName) {
                ev.emit('creds.update', { me: Object.assign(Object.assign({}, authState.creds.me), { name: msg.pushName }) });
            }
        }
        const historyMsg = getHistoryMsg(msg.message);
        const shouldProcessHistoryMsg = historyMsg
            ? shouldSyncHistoryMessage(historyMsg) &&
                PROCESSABLE_HISTORY_TYPES.includes(historyMsg.syncType)
            : false;
        if (historyMsg && shouldProcessHistoryMsg) {
            const syncType = historyMsg.syncType;
            // INITIAL_BOOTSTRAP — fire immediately, no progress check (same as WA Web K function)
            if (syncType === proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP &&
                !historySyncStatus.initialBootstrapComplete) {
                historySyncStatus.initialBootstrapComplete = true;
                ev.emit('messaging-history.status', {
                    syncType,
                    status: 'complete',
                    explicit: true
                });
            }
            // RECENT with progress === 100 — explicit completion
            if (syncType === proto.HistorySync.HistorySyncType.RECENT &&
                historyMsg.progress === 100 &&
                !historySyncStatus.recentSyncComplete) {
                historySyncStatus.recentSyncComplete = true;
                clearTimeout(historySyncPausedTimeout);
                historySyncPausedTimeout = undefined;
                ev.emit('messaging-history.status', {
                    syncType,
                    status: 'complete',
                    explicit: true
                });
            }
            // Reset 120s paused timeout on any RECENT chunk (like WA Web's handleChunkProgress)
            if (syncType === proto.HistorySync.HistorySyncType.RECENT && !historySyncStatus.recentSyncComplete) {
                clearTimeout(historySyncPausedTimeout);
                historySyncPausedTimeout = setTimeout(() => {
                    if (!historySyncStatus.recentSyncComplete) {
                        historySyncStatus.recentSyncComplete = true;
                        ev.emit('messaging-history.status', {
                            syncType: proto.HistorySync.HistorySyncType.RECENT,
                            status: 'paused',
                            explicit: false
                        });
                    }
                    historySyncPausedTimeout = undefined;
                }, HISTORY_SYNC_PAUSED_TIMEOUT_MS);
            }
        }
        // State machine: decide on sync and flush
        if (historyMsg && syncState === SyncState.AwaitingInitialSync) {
            if (awaitingSyncTimeout) {
                clearTimeout(awaitingSyncTimeout);
                awaitingSyncTimeout = undefined;
            }
            if (shouldProcessHistoryMsg) {
                syncState = SyncState.Syncing;
                logger.info('Transitioned to Syncing state');
                // Let doAppStateSync handle the final flush after it's done
            }
            else {
                syncState = SyncState.Online;
                logger.info('History sync skipped, transitioning to Online state and flushing buffer');
                ev.flush();
            }
        }
        const doAppStateSync = () => __awaiter(void 0, void 0, void 0, function* () {
            if (syncState === SyncState.Syncing) {
                // All collections will be synced, so clear any blocked ones
                blockedCollections.clear();
                logger.info('Doing app state sync');
                yield resyncAppState(ALL_WA_PATCH_NAMES, true);
                // Sync is complete, go online and flush everything
                syncState = SyncState.Online;
                logger.info('App state sync complete, transitioning to Online state and flushing buffer');
                ev.flush();
                const accountSyncCounter = (authState.creds.accountSyncCounter || 0) + 1;
                ev.emit('creds.update', { accountSyncCounter });
            }
        });
        yield Promise.all([
            (() => __awaiter(void 0, void 0, void 0, function* () {
                if (shouldProcessHistoryMsg) {
                    yield doAppStateSync();
                }
            }))(),
            processMessage(msg, {
                signalRepository,
                shouldProcessHistoryMsg,
                placeholderResendCache,
                ev,
                creds: authState.creds,
                keyStore: authState.keys,
                logger,
                options: config.options,
                getMessage
            })
        ]);
        // If the app state key arrives and we are waiting to sync, trigger the sync now.
        if (((_c = (_b = msg.message) === null || _b === void 0 ? void 0 : _b.protocolMessage) === null || _c === void 0 ? void 0 : _c.appStateSyncKeyShare) && syncState === SyncState.Syncing) {
            logger.info('App state sync key arrived, triggering app state sync');
            yield doAppStateSync();
        }
    }));
    ws.on('CB:presence', handlePresenceUpdate);
    ws.on('CB:chatstate', handlePresenceUpdate);
    ws.on('CB:ib,,dirty', (node) => __awaiter(void 0, void 0, void 0, function* () {
        const { attrs } = getBinaryNodeChild(node, 'dirty');
        const type = attrs.type;
        switch (type) {
            case 'account_sync':
                if (attrs.timestamp) {
                    let { lastAccountSyncTimestamp } = authState.creds;
                    if (lastAccountSyncTimestamp) {
                        yield cleanDirtyBits('account_sync', lastAccountSyncTimestamp);
                    }
                    lastAccountSyncTimestamp = +attrs.timestamp;
                    ev.emit('creds.update', { lastAccountSyncTimestamp });
                }
                break;
            case 'groups':
                // handled in groups.ts
                break;
            default:
                logger.info({ node }, 'received unknown sync');
                break;
        }
    }));
    ev.on('connection.update', ({ connection, receivedPendingNotifications }) => {
        if (connection === 'close') {
            blockedCollections.clear();
            clearTimeout(historySyncPausedTimeout);
            historySyncPausedTimeout = undefined;
        }
        if (connection === 'open') {
            if (fireInitQueries) {
                executeInitQueries().catch(error => onUnexpectedError(error, 'init queries'));
            }
            sendPresenceUpdate(markOnlineOnConnect ? 'available' : 'unavailable').catch(error => onUnexpectedError(error, 'presence update requests'));
        }
        if (!receivedPendingNotifications || syncState !== SyncState.Connecting) {
            return;
        }
        historySyncStatus.initialBootstrapComplete = false;
        historySyncStatus.recentSyncComplete = false;
        clearTimeout(historySyncPausedTimeout);
        historySyncPausedTimeout = undefined;
        syncState = SyncState.AwaitingInitialSync;
        logger.info('Connection is now AwaitingInitialSync, buffering events');
        ev.buffer();
        const willSyncHistory = shouldSyncHistoryMessage(proto.Message.HistorySyncNotification.create({
            syncType: proto.HistorySync.HistorySyncType.RECENT
        }));
        if (!willSyncHistory) {
            logger.info('History sync is disabled by config, not waiting for notification. Transitioning to Online.');
            syncState = SyncState.Online;
            setTimeout(() => ev.flush(), 0);
            return;
        }
        // On reconnection (accountSyncCounter > 0), the server does not push
        // history sync notifications — the device already has its data.
        // Skip the 20s wait and go online immediately.
        if (authState.creds.accountSyncCounter > 0) {
            logger.info('Reconnection with existing sync data, skipping history sync wait. Transitioning to Online.');
            syncState = SyncState.Online;
            setTimeout(() => ev.flush(), 0);
            return;
        }
        logger.info('First connection, awaiting history sync notification with a 20s timeout.');
        if (awaitingSyncTimeout) {
            clearTimeout(awaitingSyncTimeout);
        }
        awaitingSyncTimeout = setTimeout(() => {
            if (syncState === SyncState.AwaitingInitialSync) {
                logger.warn('Timeout in AwaitingInitialSync, forcing state to Online and flushing buffer');
                syncState = SyncState.Online;
                ev.flush();
                // Increment so subsequent reconnections skip the 20s wait.
                // Late-arriving history is still processed via processMessage
                // regardless of the state machine phase.
                const accountSyncCounter = (authState.creds.accountSyncCounter || 0) + 1;
                ev.emit('creds.update', { accountSyncCounter });
            }
        }, 20000);
    });
    // When an app state sync key arrives (myAppStateKeyId is set) and there are
    // collections blocked on a missing key, trigger a re-sync for just those collections.
    // This mirrors WA Web's Blocked → retry-on-key-arrival behavior.
    ev.on('creds.update', ({ myAppStateKeyId }) => {
        if (!myAppStateKeyId || blockedCollections.size === 0) {
            return;
        }
        // If we're in the middle of a full sync, doAppStateSync handles all collections
        if (syncState === SyncState.Syncing) {
            blockedCollections.clear();
            return;
        }
        const collections = [...blockedCollections];
        blockedCollections.clear();
        logger.info({ collections }, 'app state sync key arrived, re-syncing blocked collections');
        resyncAppState(collections, false).catch(error => onUnexpectedError(error, 'blocked collections resync'));
    });
    ev.on('lid-mapping.update', (_a) => __awaiter(void 0, [_a], void 0, function* ({ lid, pn }) {
        try {
            yield signalRepository.lidMapping.storeLIDPNMappings([{ lid, pn }]);
        }
        catch (error) {
            logger.warn({ lid, pn, error }, 'Failed to store LID-PN mapping');
        }
    }));
    return Object.assign(Object.assign({}, sock), { serverProps,
        createCallLink,
        getBotListV2,
        messageMutex,
        receiptMutex,
        appStatePatchMutex,
        notificationMutex,
        fetchPrivacySettings,
        upsertMessage,
        appPatch,
        sendPresenceUpdate,
        presenceSubscribe,
        profilePictureUrl,
        fetchBlocklist,
        fetchStatus,
        fetchDisappearingDuration,
        updateProfilePicture,
        removeProfilePicture,
        updateProfileStatus,
        updateProfileName,
        updateBlockStatus,
        updateDisableLinkPreviewsPrivacy,
        updateCallPrivacy,
        updateMessagesPrivacy,
        updateLastSeenPrivacy,
        updateOnlinePrivacy,
        updateProfilePicturePrivacy,
        updateStatusPrivacy,
        updateReadReceiptsPrivacy,
        updateGroupsAddPrivacy,
        updateDefaultDisappearingMode,
        getBusinessProfile,
        resyncAppState,
        chatModify,
        cleanDirtyBits,
        addOrEditContact,
        removeContact,
        addLabel,
        addChatLabel,
        removeChatLabel,
        addMessageLabel,
        removeMessageLabel,
        star,
        addOrEditQuickReply,
        removeQuickReply });
};
