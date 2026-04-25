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
import readline from 'readline';
import makeWASocket, { DEFAULT_CONNECTION_CONFIG, DisconnectReason, fetchLatestBaileysVersion, generateMessageIDV2, getAggregateVotesInPollMessage, isJidNewsletter, makeCacheableSignalKeyStore, proto, useMultiFileAuthState } from '../src';
import P from 'pino';
const logger = P({
    level: "trace",
    transport: {
        targets: [
            {
                target: "pino-pretty", // pretty-print for console
                options: { colorize: true },
                level: "trace",
            },
            {
                target: "pino/file", // raw file output
                options: { destination: './wa-logs.txt' },
                level: "trace",
            },
        ],
    },
});
logger.level = 'trace';
const doReplies = process.argv.includes('--do-reply');
const usePairingCode = process.argv.includes('--use-pairing-code');
// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache();
const onDemandMap = new Map();
// Read line interface
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));
// start a connection
const startSock = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { state, saveCreds } = yield useMultiFileAuthState('baileys_auth_info');
    // NOTE: For unit testing purposes only
    if (process.env.ADV_SECRET_KEY) {
        state.creds.advSecretKey = process.env.ADV_SECRET_KEY;
    }
    // fetch latest version of WA Web
    const { version, isLatest } = yield fetchLatestBaileysVersion();
    logger.debug({ version: version.join('.'), isLatest }, `using latest WA version`);
    const sock = makeWASocket({
        version,
        logger,
        waWebSocketUrl: (_a = process.env.SOCKET_URL) !== null && _a !== void 0 ? _a : DEFAULT_CONNECTION_CONFIG.waWebSocketUrl,
        auth: {
            creds: state.creds,
            /** caching makes the store faster to send/recv messages */
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        // ignore all broadcast messages -- to receive the same
        // comment the line below out
        // shouldIgnoreJid: jid => isJidBroadcast(jid),
        // implement to handle retries & poll updates
        getMessage
    });
    // the process function lets you process all events that just occurred
    // efficiently in a batch
    sock.ev.process(
    // events is a map for event name => event data
    (events) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        // something about the connection changed
        // maybe it closed, or we received all offline message or connection opened
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection, lastDisconnect, qr } = update;
            if (connection === 'close') {
                // reconnect if not logged out
                if (((_b = (_a = lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) === null || _a === void 0 ? void 0 : _a.output) === null || _b === void 0 ? void 0 : _b.statusCode) !== DisconnectReason.loggedOut) {
                    startSock();
                }
                else {
                    logger.fatal('Connection closed. You are logged out.');
                }
            }
            if (qr) {
                // Pairing code for Web clients
                if (usePairingCode && !sock.authState.creds.registered) {
                    const phoneNumber = yield question('Please enter your phone number:\n');
                    const code = yield sock.requestPairingCode(phoneNumber);
                    console.log(`Pairing code: ${code}`);
                }
            }
            logger.debug(update, 'connection update');
        }
        // credentials updated -- save them
        if (events['creds.update']) {
            yield saveCreds();
            logger.debug({}, 'creds save triggered');
        }
        if (events['labels.association']) {
            logger.debug(events['labels.association'], 'labels.association event fired');
        }
        if (events['labels.edit']) {
            logger.debug(events['labels.edit'], 'labels.edit event fired');
        }
        if (events['call']) {
            logger.debug(events['call'], 'call event fired');
        }
        // history received
        if (events['messaging-history.set']) {
            const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set'];
            if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
                logger.debug(messages, 'received on-demand history sync');
            }
            logger.debug({ contacts: contacts.length, chats: chats.length, messages: messages.length, isLatest, progress, syncType: syncType === null || syncType === void 0 ? void 0 : syncType.toString() }, 'messaging-history.set event fired');
        }
        // received a new message
        if (events['messages.upsert']) {
            const upsert = events['messages.upsert'];
            logger.debug(upsert, 'messages.upsert fired');
            if (!!upsert.requestId) {
                logger.debug(upsert, 'placeholder request message received');
            }
            if (upsert.type === 'notify') {
                for (const msg of upsert.messages) {
                    if (((_c = msg.message) === null || _c === void 0 ? void 0 : _c.conversation) || ((_e = (_d = msg.message) === null || _d === void 0 ? void 0 : _d.extendedTextMessage) === null || _e === void 0 ? void 0 : _e.text)) {
                        const text = ((_f = msg.message) === null || _f === void 0 ? void 0 : _f.conversation) || ((_h = (_g = msg.message) === null || _g === void 0 ? void 0 : _g.extendedTextMessage) === null || _h === void 0 ? void 0 : _h.text);
                        if (text == "requestPlaceholder" && !upsert.requestId) {
                            const messageId = yield sock.requestPlaceholderResend(msg.key);
                            logger.debug({ id: messageId }, 'requested placeholder resync');
                        }
                        // go to an old chat and send this
                        if (text == "onDemandHistSync") {
                            const messageId = yield sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
                            logger.debug({ id: messageId }, 'requested on-demand history resync');
                        }
                        if (!msg.key.fromMe && doReplies && !isJidNewsletter((_j = msg.key) === null || _j === void 0 ? void 0 : _j.remoteJid)) {
                            const id = generateMessageIDV2((_k = sock.user) === null || _k === void 0 ? void 0 : _k.id);
                            logger.debug({ id, orig_id: msg.key.id }, 'replying to message');
                            yield sock.sendMessage(msg.key.remoteJid, { text: 'pong ' + msg.key.id }, { messageId: id });
                        }
                    }
                }
            }
        }
        // messages updated like status delivered, message deleted etc.
        if (events['messages.update']) {
            logger.debug(events['messages.update'], 'messages.update fired');
            for (const { key, update } of events['messages.update']) {
                if (update.pollUpdates) {
                    const pollCreation = {}; // get the poll creation message somehow
                    if (pollCreation) {
                        console.log('got poll update, aggregation: ', getAggregateVotesInPollMessage({
                            message: pollCreation,
                            pollUpdates: update.pollUpdates,
                        }));
                    }
                }
            }
        }
        if (events['message-receipt.update']) {
            logger.debug(events['message-receipt.update']);
        }
        if (events['contacts.upsert']) {
            logger.debug(events['message-receipt.update']);
        }
        if (events['messages.reaction']) {
            logger.debug(events['messages.reaction']);
        }
        if (events['presence.update']) {
            logger.debug(events['presence.update']);
        }
        if (events['chats.update']) {
            logger.debug(events['chats.update']);
        }
        if (events['contacts.update']) {
            for (const contact of events['contacts.update']) {
                if (typeof contact.imgUrl !== 'undefined') {
                    const newUrl = contact.imgUrl === null
                        ? null
                        : yield sock.profilePictureUrl(contact.id).catch(() => null);
                    logger.debug({ id: contact.id, newUrl }, `contact has a new profile pic`);
                }
            }
        }
        if (events['chats.delete']) {
            logger.debug('chats deleted ', events['chats.delete']);
        }
        if (events['group.member-tag.update']) {
            logger.debug('group member tag update', JSON.stringify(events['group.member-tag.update'], undefined, 2));
        }
    }));
    return sock;
    function getMessage(key) {
        return __awaiter(this, void 0, void 0, function* () {
            // Implement a way to retreive messages that were upserted from messages.upsert
            // up to you
            // only if store is present
            return proto.Message.create({ conversation: 'test' });
        });
    }
});
startSock();
