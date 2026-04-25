var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { areJidsSameUser, getBinaryNodeChild, jidDecode } from '../WABinary';
import { isStringNullOrEmpty } from './generics';
export function handleIdentityChange(node, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const from = node.attrs.from;
        if (!from) {
            return { action: 'invalid_notification' };
        }
        const identityNode = getBinaryNodeChild(node, 'identity');
        if (!identityNode) {
            return { action: 'no_identity_node' };
        }
        ctx.logger.info({ jid: from }, 'identity changed');
        const decoded = jidDecode(from);
        if ((decoded === null || decoded === void 0 ? void 0 : decoded.device) && decoded.device !== 0) {
            ctx.logger.debug({ jid: from, device: decoded.device }, 'ignoring identity change from companion device');
            return { action: 'skipped_companion_device', device: decoded.device };
        }
        const isSelfPrimary = ctx.meId && (areJidsSameUser(from, ctx.meId) || (ctx.meLid && areJidsSameUser(from, ctx.meLid)));
        if (isSelfPrimary) {
            ctx.logger.info({ jid: from }, 'self primary identity changed');
            return { action: 'skipped_self_primary' };
        }
        if (ctx.debounceCache.get(from)) {
            ctx.logger.debug({ jid: from }, 'skipping identity assert (debounced)');
            return { action: 'debounced' };
        }
        ctx.debounceCache.set(from, true);
        const isOfflineNotification = !isStringNullOrEmpty(node.attrs.offline);
        const hasExistingSession = yield ctx.validateSession(from);
        if (!hasExistingSession.exists) {
            ctx.logger.debug({ jid: from }, 'no old session, skipping session refresh');
            return { action: 'skipped_no_session' };
        }
        ctx.logger.debug({ jid: from }, 'old session exists, will refresh session');
        if (isOfflineNotification) {
            ctx.logger.debug({ jid: from }, 'skipping session refresh during offline processing');
            return { action: 'skipped_offline' };
        }
        (_a = ctx.onBeforeSessionRefresh) === null || _a === void 0 ? void 0 : _a.call(ctx, from);
        try {
            yield ctx.assertSessions([from], true);
            return { action: 'session_refreshed' };
        }
        catch (error) {
            ctx.logger.warn({ error, jid: from }, 'failed to assert sessions after identity change');
            return { action: 'session_refresh_failed', error };
        }
    });
}
