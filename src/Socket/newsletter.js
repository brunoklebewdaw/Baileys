var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { QueryIds, XWAPaths } from '../Types';
import { generateProfilePicture } from '../Utils/messages-media';
import { getBinaryNodeChild } from '../WABinary';
import { makeGroupsSocket } from './groups';
import { executeWMexQuery as genericExecuteWMexQuery } from './mex';
const parseNewsletterCreateResponse = (response) => {
    const { id, thread_metadata: thread, viewer_metadata: viewer } = response;
    return {
        id: id,
        owner: undefined,
        name: thread.name.text,
        creation_time: parseInt(thread.creation_time, 10),
        description: thread.description.text,
        invite: thread.invite,
        subscribers: parseInt(thread.subscribers_count, 10),
        verification: thread.verification,
        picture: {
            id: thread.picture.id,
            directPath: thread.picture.direct_path
        },
        mute_state: viewer.mute
    };
};
const parseNewsletterMetadata = (result) => {
    if (typeof result !== 'object' || result === null) {
        return null;
    }
    if ('id' in result && typeof result.id === 'string') {
        return result;
    }
    if ('result' in result && typeof result.result === 'object' && result.result !== null && 'id' in result.result) {
        return result.result;
    }
    return null;
};
export const makeNewsletterSocket = (config) => {
    const sock = makeGroupsSocket(config);
    const { query, generateMessageTag } = sock;
    const executeWMexQuery = (variables, queryId, dataPath) => {
        return genericExecuteWMexQuery(variables, queryId, dataPath, query, generateMessageTag);
    };
    const newsletterUpdate = (jid, updates) => __awaiter(void 0, void 0, void 0, function* () {
        const variables = {
            newsletter_id: jid,
            updates: Object.assign(Object.assign({}, updates), { settings: null })
        };
        return executeWMexQuery(variables, QueryIds.UPDATE_METADATA, 'xwa2_newsletter_update');
    });
    return Object.assign(Object.assign({}, sock), { newsletterCreate: (name, description) => __awaiter(void 0, void 0, void 0, function* () {
            const variables = {
                input: {
                    name,
                    description: description !== null && description !== void 0 ? description : null
                }
            };
            const rawResponse = yield executeWMexQuery(variables, QueryIds.CREATE, XWAPaths.xwa2_newsletter_create);
            return parseNewsletterCreateResponse(rawResponse);
        }), newsletterUpdate, newsletterSubscribers: (jid) => __awaiter(void 0, void 0, void 0, function* () {
            return executeWMexQuery({ newsletter_id: jid }, QueryIds.SUBSCRIBERS, XWAPaths.xwa2_newsletter_subscribers);
        }), newsletterMetadata: (type, key) => __awaiter(void 0, void 0, void 0, function* () {
            const variables = {
                fetch_creation_time: true,
                fetch_full_image: true,
                fetch_viewer_metadata: true,
                input: {
                    key,
                    type: type.toUpperCase()
                }
            };
            const result = yield executeWMexQuery(variables, QueryIds.METADATA, XWAPaths.xwa2_newsletter_metadata);
            return parseNewsletterMetadata(result);
        }), newsletterFollow: (jid) => {
            return executeWMexQuery({ newsletter_id: jid }, QueryIds.FOLLOW, XWAPaths.xwa2_newsletter_follow);
        }, newsletterUnfollow: (jid) => {
            return executeWMexQuery({ newsletter_id: jid }, QueryIds.UNFOLLOW, XWAPaths.xwa2_newsletter_unfollow);
        }, newsletterMute: (jid) => {
            return executeWMexQuery({ newsletter_id: jid }, QueryIds.MUTE, XWAPaths.xwa2_newsletter_mute_v2);
        }, newsletterUnmute: (jid) => {
            return executeWMexQuery({ newsletter_id: jid }, QueryIds.UNMUTE, XWAPaths.xwa2_newsletter_unmute_v2);
        }, newsletterUpdateName: (jid, name) => __awaiter(void 0, void 0, void 0, function* () {
            return yield newsletterUpdate(jid, { name });
        }), newsletterUpdateDescription: (jid, description) => __awaiter(void 0, void 0, void 0, function* () {
            return yield newsletterUpdate(jid, { description });
        }), newsletterUpdatePicture: (jid, content) => __awaiter(void 0, void 0, void 0, function* () {
            const { img } = yield generateProfilePicture(content);
            return yield newsletterUpdate(jid, { picture: img.toString('base64') });
        }), newsletterRemovePicture: (jid) => __awaiter(void 0, void 0, void 0, function* () {
            return yield newsletterUpdate(jid, { picture: '' });
        }), newsletterReactMessage: (jid, serverId, reaction) => __awaiter(void 0, void 0, void 0, function* () {
            yield query({
                tag: 'message',
                attrs: Object.assign(Object.assign({ to: jid }, (reaction ? {} : { edit: '7' })), { type: 'reaction', server_id: serverId, id: generateMessageTag() }),
                content: [
                    {
                        tag: 'reaction',
                        attrs: reaction ? { code: reaction } : {}
                    }
                ]
            });
        }), newsletterFetchMessages: (jid, count, since, after) => __awaiter(void 0, void 0, void 0, function* () {
            const messageUpdateAttrs = {
                count: count.toString()
            };
            if (typeof since === 'number') {
                messageUpdateAttrs.since = since.toString();
            }
            if (after) {
                messageUpdateAttrs.after = after.toString();
            }
            const result = yield query({
                tag: 'iq',
                attrs: {
                    id: generateMessageTag(),
                    type: 'get',
                    xmlns: 'newsletter',
                    to: jid
                },
                content: [
                    {
                        tag: 'message_updates',
                        attrs: messageUpdateAttrs
                    }
                ]
            });
            return result;
        }), subscribeNewsletterUpdates: (jid) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const result = yield query({
                tag: 'iq',
                attrs: {
                    id: generateMessageTag(),
                    type: 'set',
                    xmlns: 'newsletter',
                    to: jid
                },
                content: [{ tag: 'live_updates', attrs: {}, content: [] }]
            });
            const liveUpdatesNode = getBinaryNodeChild(result, 'live_updates');
            const duration = (_a = liveUpdatesNode === null || liveUpdatesNode === void 0 ? void 0 : liveUpdatesNode.attrs) === null || _a === void 0 ? void 0 : _a.duration;
            return duration ? { duration: duration } : null;
        }), newsletterAdminCount: (jid) => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield executeWMexQuery({ newsletter_id: jid }, QueryIds.ADMIN_COUNT, XWAPaths.xwa2_newsletter_admin_count);
            return response.admin_count;
        }), newsletterChangeOwner: (jid, newOwnerJid) => __awaiter(void 0, void 0, void 0, function* () {
            yield executeWMexQuery({ newsletter_id: jid, user_id: newOwnerJid }, QueryIds.CHANGE_OWNER, XWAPaths.xwa2_newsletter_change_owner);
        }), newsletterDemote: (jid, userJid) => __awaiter(void 0, void 0, void 0, function* () {
            yield executeWMexQuery({ newsletter_id: jid, user_id: userJid }, QueryIds.DEMOTE, XWAPaths.xwa2_newsletter_demote);
        }), newsletterDelete: (jid) => __awaiter(void 0, void 0, void 0, function* () {
            yield executeWMexQuery({ newsletter_id: jid }, QueryIds.DELETE, XWAPaths.xwa2_newsletter_delete_v2);
        }) });
};
