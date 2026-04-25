var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import P from 'pino';
import makeWASocket, { DisconnectReason, downloadContentFromMessage, downloadMediaMessage, jidNormalizedUser, proto, toBuffer, useMultiFileAuthState } from '../../index';
jest.setTimeout(30000);
describe('E2E Tests', () => {
    let sock;
    let meJid;
    let meLid;
    let groupJid;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        const { state, saveCreds } = yield useMultiFileAuthState('baileys_auth_info');
        const logger = P({ level: 'silent' });
        sock = makeWASocket({
            auth: state,
            logger
        });
        sock.ev.on('creds.update', saveCreds);
        yield new Promise((resolve, reject) => {
            sock.ev.on('connection.update', update => {
                var _a, _b, _c, _d;
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    meJid = jidNormalizedUser((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id);
                    meLid = (_b = sock.user) === null || _b === void 0 ? void 0 : _b.lid;
                    sock
                        .groupFetchAllParticipating()
                        .then(groups => {
                        const group = Object.values(groups).find(g => g.subject === 'Baileys Group Test');
                        if (group) {
                            groupJid = group.id;
                            console.log(`Found test group "${group.subject}" with JID: ${groupJid}`);
                        }
                        resolve();
                    })
                        .catch(reject);
                }
                else if (connection === 'close') {
                    const reason = (_d = (_c = lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) === null || _c === void 0 ? void 0 : _c.output) === null || _d === void 0 ? void 0 : _d.statusCode;
                    if (reason === DisconnectReason.loggedOut) {
                        console.error('Logged out, please delete the baileys_auth_info_e2e folder and re-run the test');
                    }
                    if (lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) {
                        reject(new Error(`Connection closed: ${DisconnectReason[reason] || 'unknown'}`));
                    }
                }
            });
        });
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        if (sock) {
            yield sock.end(undefined);
        }
    }));
    test('should send a message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const messageContent = `E2E Test Message ${Date.now()}`;
        const sentMessage = yield sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message:', sentMessage.key.id);
        expect(sentMessage.key.id).toBeTruthy();
        expect(((_b = (_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.text) || ((_c = sentMessage.message) === null || _c === void 0 ? void 0 : _c.conversation)).toBe(messageContent);
    }));
    test('should edit a message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to Edit ${Date.now()}`;
        const sentMessage = yield sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to edit:', sentMessage.key.id);
        const newContent = `E2E Edited Message ${Date.now()}`;
        const editedMessage = yield sock.sendMessage(meJid, {
            text: newContent,
            edit: sentMessage.key
        });
        expect(editedMessage).toBeDefined();
        console.log('Edited message response:', editedMessage.key.id);
        expect((_b = (_a = editedMessage.message) === null || _a === void 0 ? void 0 : _a.protocolMessage) === null || _b === void 0 ? void 0 : _b.type).toBe(proto.Message.ProtocolMessage.Type.MESSAGE_EDIT);
        const editedContent = (_d = (_c = editedMessage.message) === null || _c === void 0 ? void 0 : _c.protocolMessage) === null || _d === void 0 ? void 0 : _d.editedMessage;
        expect(((_e = editedContent === null || editedContent === void 0 ? void 0 : editedContent.extendedTextMessage) === null || _e === void 0 ? void 0 : _e.text) || (editedContent === null || editedContent === void 0 ? void 0 : editedContent.conversation)).toBe(newContent);
    }));
    test('should react to a message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to React to ${Date.now()}`;
        const sentMessage = yield sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to react to:', sentMessage.key.id);
        const reaction = '👍';
        const reactionMessage = yield sock.sendMessage(meJid, {
            react: {
                text: reaction,
                key: sentMessage.key
            }
        });
        expect(reactionMessage).toBeDefined();
        console.log('Sent reaction:', reactionMessage.key.id);
        expect((_b = (_a = reactionMessage.message) === null || _a === void 0 ? void 0 : _a.reactionMessage) === null || _b === void 0 ? void 0 : _b.text).toBe(reaction);
        expect((_e = (_d = (_c = reactionMessage.message) === null || _c === void 0 ? void 0 : _c.reactionMessage) === null || _d === void 0 ? void 0 : _d.key) === null || _e === void 0 ? void 0 : _e.id).toBe(sentMessage.key.id);
    }));
    test('should remove a reaction from a message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to Remove Reaction from ${Date.now()}`;
        const sentMessage = yield sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to remove reaction from:', sentMessage.key.id);
        yield sock.sendMessage(meJid, {
            react: {
                text: '😄',
                key: sentMessage.key
            }
        });
        const removeReactionMessage = yield sock.sendMessage(meJid, {
            react: {
                text: '',
                key: sentMessage.key
            }
        });
        expect(removeReactionMessage).toBeDefined();
        console.log('Sent remove reaction:', removeReactionMessage.key.id);
        expect((_b = (_a = removeReactionMessage.message) === null || _a === void 0 ? void 0 : _a.reactionMessage) === null || _b === void 0 ? void 0 : _b.text).toBe('');
        expect((_e = (_d = (_c = removeReactionMessage.message) === null || _c === void 0 ? void 0 : _c.reactionMessage) === null || _d === void 0 ? void 0 : _d.key) === null || _e === void 0 ? void 0 : _e.id).toBe(sentMessage.key.id);
    }));
    test('should delete a message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to Delete ${Date.now()}`;
        const sentMessage = yield sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to delete:', sentMessage.key.id);
        const deleteMessage = yield sock.sendMessage(meJid, {
            delete: sentMessage.key
        });
        expect(deleteMessage).toBeDefined();
        console.log('Sent delete message command:', deleteMessage.key.id);
        expect((_b = (_a = deleteMessage.message) === null || _a === void 0 ? void 0 : _a.protocolMessage) === null || _b === void 0 ? void 0 : _b.type).toBe(proto.Message.ProtocolMessage.Type.REVOKE);
        expect((_e = (_d = (_c = deleteMessage.message) === null || _c === void 0 ? void 0 : _c.protocolMessage) === null || _d === void 0 ? void 0 : _d.key) === null || _e === void 0 ? void 0 : _e.id).toBe(sentMessage.key.id);
    }));
    test('should forward a message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const messageContent = `E2E Test Message to Forward ${Date.now()}`;
        const sentMessage = yield sock.sendMessage(meJid, {
            text: messageContent
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to forward:', sentMessage.key.id);
        const forwardedMessage = yield sock.sendMessage(meJid, {
            forward: sentMessage
        });
        expect(forwardedMessage).toBeDefined();
        console.log('Forwarded message:', forwardedMessage.key.id);
        const content = ((_b = (_a = forwardedMessage.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.text) || ((_c = forwardedMessage.message) === null || _c === void 0 ? void 0 : _c.conversation);
        expect(content).toBe(messageContent);
        expect(forwardedMessage.key.id).not.toBe(sentMessage.key.id);
    }));
    test('should send an image message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const image = readFileSync('./Media/cat.jpeg');
        const sentMessage = yield sock.sendMessage(meJid, {
            image: image,
            caption: 'E2E Test Image'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent image message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.imageMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.imageMessage) === null || _c === void 0 ? void 0 : _c.caption).toBe('E2E Test Image');
    }));
    test('should send a video message with a thumbnail', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const video = readFileSync('./Media/ma_gif.mp4');
        const sentMessage = yield sock.sendMessage(meJid, {
            video: video,
            caption: 'E2E Test Video'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent video message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.videoMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.videoMessage) === null || _c === void 0 ? void 0 : _c.caption).toBe('E2E Test Video');
    }));
    test('should send a PTT (push-to-talk) audio message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const audio = readFileSync('./Media/sonata.mp3');
        const sentMessage = yield sock.sendMessage(meJid, {
            audio: audio,
            ptt: true,
            mimetype: 'audio/mp4'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent PTT audio message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.audioMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.audioMessage) === null || _c === void 0 ? void 0 : _c.ptt).toBe(true);
    }));
    test('should send a document message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const document = readFileSync('./Media/ma_gif.mp4');
        const sentMessage = yield sock.sendMessage(meJid, {
            document: document,
            mimetype: 'application/pdf',
            fileName: 'E2E Test Document.pdf'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent document message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.documentMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.documentMessage) === null || _c === void 0 ? void 0 : _c.fileName).toBe('E2E Test Document.pdf');
    }));
    test('should send a sticker message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const sticker = readFileSync('./Media/cat.jpeg');
        const sentMessage = yield sock.sendMessage(meJid, {
            sticker: sticker
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent sticker message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.stickerMessage).toBeDefined();
    }));
    test('should send a poll message and receive a vote', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const poll = {
            name: 'E2E Test Poll',
            values: ['Option 1', 'Option 2', 'Option 3'],
            selectableCount: 1
        };
        const sentPoll = yield sock.sendMessage(meJid, { poll });
        expect(sentPoll).toBeDefined();
        console.log('Sent poll message:', sentPoll.key.id);
        expect((_a = sentPoll === null || sentPoll === void 0 ? void 0 : sentPoll.message) === null || _a === void 0 ? void 0 : _a.pollCreationMessageV3).toBeDefined();
        expect((_c = (_b = sentPoll === null || sentPoll === void 0 ? void 0 : sentPoll.message) === null || _b === void 0 ? void 0 : _b.pollCreationMessageV3) === null || _c === void 0 ? void 0 : _c.name).toBe('E2E Test Poll');
    }));
    test('should send a contact (vCard) message', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const vcard = 'BEGIN:VCARD\n' +
            'VERSION:3.0\n' +
            'FN:E2E Test Contact\n' +
            'ORG:Baileys Tests;\n' +
            'TEL;type=CELL;type=VOICE;waid=1234567890:+1 234-567-890\n' +
            'END:VCARD';
        const sentMessage = yield sock.sendMessage(meJid, {
            contacts: {
                displayName: 'E2E Test Contact',
                contacts: [{ vcard }]
            }
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent contact message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.contactMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.contactMessage) === null || _c === void 0 ? void 0 : _c.vcard).toContain('FN:E2E Test Contact');
    }));
    test('should send and download an image message', () => __awaiter(void 0, void 0, void 0, function* () {
        const image = readFileSync('./Media/cat.jpeg');
        const caption = 'E2E Test Image Download Success';
        let listener;
        let timeoutId;
        try {
            const receivedMsgPromise = new Promise((resolve, reject) => {
                listener = ({ messages }) => {
                    const msg = messages.find(m => { var _a, _b; return ((_b = (_a = m.message) === null || _a === void 0 ? void 0 : _a.imageMessage) === null || _b === void 0 ? void 0 : _b.caption) === caption; });
                    if (msg) {
                        resolve(msg);
                    }
                };
                timeoutId = setTimeout(() => {
                    reject(new Error('Timed out waiting for the image message to be received'));
                }, 30000);
                sock.ev.on('messages.upsert', listener);
            });
            yield sock.sendMessage(meJid, {
                image: image,
                caption: caption
            });
            const receivedMsg = yield receivedMsgPromise;
            clearTimeout(timeoutId);
            timeoutId = undefined;
            console.log('Received image message, attempting to download...');
            const buffer = yield downloadMediaMessage(receivedMsg, 'buffer', {}, {
                logger: sock.logger,
                reuploadRequest: m => sock.updateMediaMessage(m)
            });
            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(0);
            console.log('Successfully downloaded the image.');
        }
        finally {
            if (listener) {
                sock.ev.off('messages.upsert', listener);
            }
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }));
    test('should send and download an image message via LID', () => __awaiter(void 0, void 0, void 0, function* () {
        console.log(`Testing with self-LID: ${meLid}`);
        const image = readFileSync('./Media/cat.jpeg');
        const caption = 'E2E Test LID Image Download';
        let listener;
        let timeoutId;
        try {
            const receivedMsgPromise = new Promise((resolve, reject) => {
                listener = ({ messages }) => {
                    const msg = messages.find(m => { var _a, _b; return ((_b = (_a = m.message) === null || _a === void 0 ? void 0 : _a.imageMessage) === null || _b === void 0 ? void 0 : _b.caption) === caption; });
                    if (msg) {
                        resolve(msg);
                    }
                };
                timeoutId = setTimeout(() => {
                    reject(new Error('Timed out waiting for the LID image message to be received'));
                }, 30000);
                sock.ev.on('messages.upsert', listener);
            });
            yield sock.sendMessage(meLid, {
                image: image,
                caption: caption
            });
            const receivedMsg = yield receivedMsgPromise;
            clearTimeout(timeoutId);
            timeoutId = undefined;
            console.log('Received LID image message, attempting to download...');
            const buffer = yield downloadMediaMessage(receivedMsg, 'buffer', {}, {
                logger: sock.logger,
                reuploadRequest: m => sock.updateMediaMessage(m)
            });
            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(0);
            console.log('Successfully downloaded the image sent via LID.');
        }
        finally {
            if (listener) {
                sock.ev.off('messages.upsert', listener);
            }
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }));
    test('should send and download an image using the low-level downloadContentFromMessage', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const image = readFileSync('./Media/cat.jpeg');
        const caption = 'E2E Test Low-Level Download';
        let listener;
        let timeoutId;
        try {
            const receivedMsgPromise = new Promise((resolve, reject) => {
                listener = ({ messages }) => {
                    const msg = messages.find(m => { var _a, _b; return ((_b = (_a = m.message) === null || _a === void 0 ? void 0 : _a.imageMessage) === null || _b === void 0 ? void 0 : _b.caption) === caption; });
                    if (msg) {
                        resolve(msg);
                    }
                };
                timeoutId = setTimeout(() => {
                    reject(new Error('Timed out waiting for the low-level test message'));
                }, 30000);
                sock.ev.on('messages.upsert', listener);
            });
            yield sock.sendMessage(meJid, {
                image: image,
                caption: caption
            });
            const receivedMsg = yield receivedMsgPromise;
            clearTimeout(timeoutId);
            timeoutId = undefined;
            console.log('Received message for low-level download test, preparing to download...');
            const imageMessage = (_a = receivedMsg.message) === null || _a === void 0 ? void 0 : _a.imageMessage;
            expect(imageMessage).toBeDefined();
            const downloadable = {
                url: imageMessage.url,
                mediaKey: imageMessage.mediaKey,
                directPath: imageMessage.directPath
            };
            const stream = yield downloadContentFromMessage(downloadable, 'image');
            const buffer = yield toBuffer(stream);
            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(0);
            console.log('Successfully downloaded the image using downloadContentFromMessage.');
        }
        finally {
            if (listener) {
                sock.ev.off('messages.upsert', listener);
            }
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }));
    test('should download a quoted image message using downloadContentFromMessage', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const image = readFileSync('./Media/cat.jpeg');
        const originalCaption = 'This is the original media message';
        const commandText = '-download';
        let imageListener;
        let commandListener;
        let timeoutId;
        try {
            console.log('Sending initial image message...');
            const receivedImagePromise = new Promise((resolve, reject) => {
                imageListener = ({ messages }) => {
                    const msg = messages.find(m => { var _a, _b; return ((_b = (_a = m.message) === null || _a === void 0 ? void 0 : _a.imageMessage) === null || _b === void 0 ? void 0 : _b.caption) === originalCaption; });
                    if (msg)
                        resolve(msg);
                };
                sock.ev.on('messages.upsert', imageListener);
                timeoutId = setTimeout(() => reject(new Error('Timed out waiting for initial image message')), 30000);
            });
            const sentImageMessage = yield sock.sendMessage(meJid, {
                image: image,
                caption: originalCaption
            });
            yield receivedImagePromise;
            clearTimeout(timeoutId);
            timeoutId = undefined;
            if (imageListener) {
                sock.ev.off('messages.upsert', imageListener);
            }
            console.log('Initial image message sent and received.');
            console.log('Sending command message as a reply...');
            const receivedCommandPromise = new Promise((resolve, reject) => {
                commandListener = ({ messages }) => {
                    const msg = messages.find(m => { var _a, _b; return ((_b = (_a = m.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.text) === commandText; });
                    if (msg)
                        resolve(msg);
                };
                sock.ev.on('messages.upsert', commandListener);
                timeoutId = setTimeout(() => reject(new Error('Timed out waiting for command message')), 30000);
            });
            yield sock.sendMessage(meJid, { text: commandText }, { quoted: sentImageMessage });
            const receivedCommandMessage = yield receivedCommandPromise;
            clearTimeout(timeoutId);
            timeoutId = undefined;
            console.log('Command message received.');
            console.log('Extracting quoted message and attempting download...');
            const quotedMessage = (_c = (_b = (_a = receivedCommandMessage.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.contextInfo) === null || _c === void 0 ? void 0 : _c.quotedMessage;
            expect(quotedMessage).toBeDefined();
            const quotedImage = quotedMessage.imageMessage;
            expect(quotedImage).toBeDefined();
            const downloadable = {
                url: quotedImage.url,
                mediaKey: quotedImage.mediaKey,
                directPath: quotedImage.directPath
            };
            const stream = yield downloadContentFromMessage(downloadable, 'image');
            const buffer = yield toBuffer(stream);
            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(0);
            console.log('Successfully downloaded quoted image using downloadContentFromMessage.');
        }
        finally {
            if (imageListener)
                sock.ev.off('messages.upsert', imageListener);
            if (commandListener)
                sock.ev.off('messages.upsert', commandListener);
            if (timeoutId)
                clearTimeout(timeoutId);
        }
    }));
    test('should download a quoted videos message within a group', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!groupJid) {
            console.warn('⚠️ Skipping group test because "Baileys Group Test" was not found.');
            return;
        }
        const video = readFileSync('./Media/ma_gif.mp4');
        const originalCaption = 'This is the original media message for the group test';
        const commandText = '-download group';
        let videoListener;
        let commandListener;
        let timeoutId;
        try {
            console.log(`Sending initial video message to group ${groupJid}...`);
            const receivedVideoPromise = new Promise((resolve, reject) => {
                videoListener = ({ messages }) => {
                    const msg = messages.find(m => { var _a, _b; return m.key.remoteJid === groupJid && ((_b = (_a = m.message) === null || _a === void 0 ? void 0 : _a.videoMessage) === null || _b === void 0 ? void 0 : _b.caption) === originalCaption; });
                    if (msg)
                        resolve(msg);
                };
                sock.ev.on('messages.upsert', videoListener);
                timeoutId = setTimeout(() => reject(new Error('Timed out waiting for initial group image message')), 30000);
            });
            const sentVideoMessage = yield sock.sendMessage(groupJid, {
                video: video,
                caption: originalCaption
            });
            yield receivedVideoPromise;
            clearTimeout(timeoutId);
            timeoutId = undefined;
            if (videoListener)
                sock.ev.off('messages.upsert', videoListener);
            console.log('Initial group image message sent and received.');
            console.log('Sending command message as a reply in the group...');
            const receivedCommandPromise = new Promise((resolve, reject) => {
                commandListener = ({ messages }) => {
                    const msg = messages.find(m => { var _a, _b; return m.key.remoteJid === groupJid && ((_b = (_a = m.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.text) === commandText; });
                    if (msg)
                        resolve(msg);
                };
                sock.ev.on('messages.upsert', commandListener);
                timeoutId = setTimeout(() => reject(new Error('Timed out waiting for group command message')), 30000);
            });
            yield sock.sendMessage(groupJid, { text: commandText }, { quoted: sentVideoMessage });
            const receivedCommandMessage = yield receivedCommandPromise;
            clearTimeout(timeoutId);
            timeoutId = undefined;
            console.log('Group command message received.');
            console.log('Extracting quoted message from group chat and attempting download...');
            const quotedMessage = (_c = (_b = (_a = receivedCommandMessage.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.contextInfo) === null || _c === void 0 ? void 0 : _c.quotedMessage;
            expect(quotedMessage).toBeDefined();
            console.log('quotedMessage', JSON.stringify(quotedMessage, null, 2));
            const quotedVideo = quotedMessage.videoMessage;
            expect(quotedVideo).toBeDefined();
            console.log('quotedVideo', JSON.stringify(quotedVideo, null, 2));
            const downloadable = {
                url: quotedVideo.url,
                mediaKey: quotedVideo.mediaKey,
                directPath: quotedVideo.directPath
            };
            const stream = yield downloadContentFromMessage(downloadable, 'video');
            const buffer = yield toBuffer(stream);
            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(0);
            console.log('Successfully downloaded quoted image from group message.');
        }
        finally {
            if (videoListener)
                sock.ev.off('messages.upsert', videoListener);
            if (commandListener)
                sock.ev.off('messages.upsert', commandListener);
            if (timeoutId)
                clearTimeout(timeoutId);
        }
    }));
});
