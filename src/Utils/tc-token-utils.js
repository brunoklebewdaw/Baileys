var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getBinaryNodeChild, getBinaryNodeChildren, isHostedLidUser, isHostedPnUser, isJidMetaAI, isLidUser, isPnUser, jidNormalizedUser } from '../WABinary';
// Same phone-number pattern as WABinary's isJidBot, applied against the user
// part so the check is invariant to @c.us ↔ @s.whatsapp.net normalization.
const BOT_PHONE_REGEX = /^1313555\d{4}$|^131655500\d{2}$/;
/**
 * Mirrors WA Web's `Wid.isRegularUser()` (user ∧ ¬PSA ∧ ¬Bot). Used to gate tctoken
 * storage against malformed notifications — WA Web filters server-side but we
 * defend here for parity with `WAWebSetTcTokenChatAction.handleIncomingTcToken`.
 * Works for both pre- and post-normalized JIDs (`@c.us` vs `@s.whatsapp.net`).
 */
function isRegularUser(jid) {
    var _a;
    if (!jid)
        return false;
    const user = (_a = jid.split('@')[0]) !== null && _a !== void 0 ? _a : '';
    if (user === '0')
        return false; // PSA
    if (BOT_PHONE_REGEX.test(user))
        return false; // Bot by phone pattern
    if (isJidMetaAI(jid))
        return false; // MetaAI (@bot server)
    return !!(isPnUser(jid) || isLidUser(jid) || isHostedPnUser(jid) || isHostedLidUser(jid) || jid.endsWith('@c.us'));
}
const TC_TOKEN_BUCKET_DURATION = 604800; // 7 days
const TC_TOKEN_NUM_BUCKETS = 4; // ~28-day rolling window
/** Sentinel key under `tctoken` store holding a JSON array of tracked storage JIDs for cross-session pruning. */
export const TC_TOKEN_INDEX_KEY = '__index';
/** Read the persisted tctoken JID index and return its entries (never contains the sentinel key itself). */
export function readTcTokenIndex(keys) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const data = yield keys.get('tctoken', [TC_TOKEN_INDEX_KEY]);
        const entry = data[TC_TOKEN_INDEX_KEY];
        if (!((_a = entry === null || entry === void 0 ? void 0 : entry.token) === null || _a === void 0 ? void 0 : _a.length))
            return [];
        try {
            const parsed = JSON.parse(Buffer.from(entry.token).toString());
            if (!Array.isArray(parsed))
                return [];
            return parsed.filter((j) => typeof j === 'string' && j.length > 0 && j !== TC_TOKEN_INDEX_KEY);
        }
        catch (_b) {
            return [];
        }
    });
}
/** Build a SignalDataSet fragment that writes the merged index (persisted ∪ added) under the sentinel key. */
export function buildMergedTcTokenIndexWrite(keys, addedJids) {
    return __awaiter(this, void 0, void 0, function* () {
        const persisted = yield readTcTokenIndex(keys);
        const merged = new Set(persisted);
        for (const jid of addedJids) {
            if (jid && jid !== TC_TOKEN_INDEX_KEY)
                merged.add(jid);
        }
        return {
            [TC_TOKEN_INDEX_KEY]: { token: Buffer.from(JSON.stringify([...merged])) }
        };
    });
}
// WA Web has separate sender/receiver AB props for these but they're identical today
export function isTcTokenExpired(timestamp) {
    if (timestamp === null || timestamp === undefined)
        return true;
    const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
    if (isNaN(ts))
        return true;
    const now = Math.floor(Date.now() / 1000);
    const currentBucket = Math.floor(now / TC_TOKEN_BUCKET_DURATION);
    const cutoffBucket = currentBucket - (TC_TOKEN_NUM_BUCKETS - 1);
    const cutoffTimestamp = cutoffBucket * TC_TOKEN_BUCKET_DURATION;
    return ts < cutoffTimestamp;
}
export function shouldSendNewTcToken(senderTimestamp) {
    if (senderTimestamp === undefined)
        return true;
    const now = Math.floor(Date.now() / 1000);
    const currentBucket = Math.floor(now / TC_TOKEN_BUCKET_DURATION);
    const senderBucket = Math.floor(senderTimestamp / TC_TOKEN_BUCKET_DURATION);
    return currentBucket > senderBucket;
}
/** Resolve JID to LID for tctoken storage (WA Web stores under LID) */
export function resolveTcTokenJid(jid, getLIDForPN) {
    return __awaiter(this, void 0, void 0, function* () {
        if (isLidUser(jid))
            return jid;
        const lid = yield getLIDForPN(jid);
        return lid !== null && lid !== void 0 ? lid : jid;
    });
}
/** Resolve target JID for issuing privacy token based on AB prop 14303 */
export function resolveIssuanceJid(jid, issueToLid, getLIDForPN, getPNForLID) {
    return __awaiter(this, void 0, void 0, function* () {
        if (issueToLid) {
            if (isLidUser(jid))
                return jid;
            const lid = yield getLIDForPN(jid);
            return lid !== null && lid !== void 0 ? lid : jid;
        }
        if (!isLidUser(jid))
            return jid;
        if (getPNForLID) {
            const pn = yield getPNForLID(jid);
            return pn !== null && pn !== void 0 ? pn : jid;
        }
        return jid;
    });
}
export function buildTcTokenFromJid(_a) {
    return __awaiter(this, arguments, void 0, function* ({ authState, jid, baseContent = [], getLIDForPN }) {
        try {
            const storageJid = yield resolveTcTokenJid(jid, getLIDForPN);
            const tcTokenData = yield authState.keys.get('tctoken', [storageJid]);
            const entry = tcTokenData === null || tcTokenData === void 0 ? void 0 : tcTokenData[storageJid];
            const tcTokenBuffer = entry === null || entry === void 0 ? void 0 : entry.token;
            if (!(tcTokenBuffer === null || tcTokenBuffer === void 0 ? void 0 : tcTokenBuffer.length) || isTcTokenExpired(entry === null || entry === void 0 ? void 0 : entry.timestamp)) {
                if (tcTokenBuffer) {
                    // Preserve senderTimestamp so shouldSendNewTcToken() keeps its dedupe state
                    // after we drop the unusable peer token. Only wipe the record entirely when
                    // there's nothing worth keeping.
                    const cleared = (entry === null || entry === void 0 ? void 0 : entry.senderTimestamp) !== undefined
                        ? { token: Buffer.alloc(0), senderTimestamp: entry.senderTimestamp }
                        : null;
                    yield authState.keys.set({ tctoken: { [storageJid]: cleared } });
                }
                return baseContent.length > 0 ? baseContent : undefined;
            }
            baseContent.push({
                tag: 'tctoken',
                attrs: {},
                content: tcTokenBuffer
            });
            return baseContent;
        }
        catch (error) {
            return baseContent.length > 0 ? baseContent : undefined;
        }
    });
}
export function storeTcTokensFromIqResult(_a) {
    return __awaiter(this, arguments, void 0, function* ({ result, fallbackJid, keys, getLIDForPN, onNewJidStored }) {
        const tokensNode = getBinaryNodeChild(result, 'tokens');
        if (!tokensNode)
            return;
        const tokenNodes = getBinaryNodeChildren(tokensNode, 'token');
        for (const tokenNode of tokenNodes) {
            if (tokenNode.attrs.type !== 'trusted_contact' || !(tokenNode.content instanceof Uint8Array)) {
                continue;
            }
            // In notifications tokenNode.attrs.jid is your own device JID, not the sender's
            const rawJid = jidNormalizedUser(fallbackJid || tokenNode.attrs.jid);
            if (!isRegularUser(rawJid))
                continue;
            const storageJid = yield resolveTcTokenJid(rawJid, getLIDForPN);
            const existingTcData = yield keys.get('tctoken', [storageJid]);
            const existingEntry = existingTcData[storageJid];
            const existingTs = (existingEntry === null || existingEntry === void 0 ? void 0 : existingEntry.timestamp) ? Number(existingEntry.timestamp) : 0;
            const incomingTs = tokenNode.attrs.t ? Number(tokenNode.attrs.t) : 0;
            // timestamp-less tokens would be immediately expired
            if (!incomingTs)
                continue;
            if (existingTs > 0 && existingTs > incomingTs)
                continue;
            yield keys.set({
                tctoken: {
                    [storageJid]: Object.assign(Object.assign({}, existingEntry), { token: Buffer.from(tokenNode.content), timestamp: tokenNode.attrs.t })
                }
            });
            onNewJidStored === null || onNewJidStored === void 0 ? void 0 : onNewJidStored(storageJid);
        }
    });
}
