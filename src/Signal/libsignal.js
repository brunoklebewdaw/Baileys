var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// @ts-ignore
import * as libsignal from 'libsignal';
// @ts-ignore
import { PreKeyWhisperMessage } from 'libsignal/src/protobufs';
import { LRUCache } from 'lru-cache';
import { generateSignalPubKey } from '../Utils';
import { isHostedLidUser, isHostedPnUser, isLidUser, isPnUser, jidDecode, transferDevice, WAJIDDomains } from '../WABinary';
import { SenderKeyName } from './Group/sender-key-name';
import { SenderKeyRecord } from './Group/sender-key-record';
import { GroupCipher, GroupSessionBuilder, SenderKeyDistributionMessage } from './Group';
import { LIDMappingStore } from './lid-mapping';
/** Extract identity key from PreKeyWhisperMessage for identity change detection */
function extractIdentityFromPkmsg(ciphertext) {
    var _a;
    try {
        if (!ciphertext || ciphertext.length < 2) {
            return undefined;
        }
        // Version byte check (version 3)
        const version = ciphertext[0];
        if ((version & 0xf) !== 3) {
            return undefined;
        }
        // Parse protobuf (skip version byte)
        const preKeyProto = PreKeyWhisperMessage.decode(ciphertext.slice(1));
        if (((_a = preKeyProto.identityKey) === null || _a === void 0 ? void 0 : _a.length) === 33) {
            return new Uint8Array(preKeyProto.identityKey);
        }
        return undefined;
    }
    catch (_b) {
        return undefined;
    }
}
export function makeLibSignalRepository(auth, logger, pnToLIDFunc) {
    const lidMapping = new LIDMappingStore(auth.keys, logger, pnToLIDFunc);
    const storage = signalStorage(auth, lidMapping);
    const parsedKeys = auth.keys;
    const migratedSessionCache = new LRUCache({
        ttl: 3 * 24 * 60 * 60 * 1000, // 7 days
        ttlAutopurge: true,
        updateAgeOnGet: true
    });
    const repository = {
        decryptGroupMessage({ group, authorJid, msg }) {
            const senderName = jidToSignalSenderKeyName(group, authorJid);
            const cipher = new GroupCipher(storage, senderName);
            // Use transaction to ensure atomicity
            return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                return cipher.decrypt(msg);
            }), group);
        },
        processSenderKeyDistributionMessage(_a) {
            return __awaiter(this, arguments, void 0, function* ({ item, authorJid }) {
                const builder = new GroupSessionBuilder(storage);
                if (!item.groupId) {
                    throw new Error('Group ID is required for sender key distribution message');
                }
                const senderName = jidToSignalSenderKeyName(item.groupId, authorJid);
                const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage);
                const senderNameStr = senderName.toString();
                const { [senderNameStr]: senderKey } = yield auth.keys.get('sender-key', [senderNameStr]);
                if (!senderKey) {
                    yield storage.storeSenderKey(senderName, new SenderKeyRecord());
                }
                return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                    const { [senderNameStr]: senderKey } = yield auth.keys.get('sender-key', [senderNameStr]);
                    if (!senderKey) {
                        yield storage.storeSenderKey(senderName, new SenderKeyRecord());
                    }
                    yield builder.process(senderName, senderMsg);
                }), item.groupId);
            });
        },
        decryptMessage(_a) {
            return __awaiter(this, arguments, void 0, function* ({ jid, type, ciphertext }) {
                const addr = jidToSignalProtocolAddress(jid);
                const session = new libsignal.SessionCipher(storage, addr);
                // Extract and save sender's identity key before decryption for identity change detection
                if (type === 'pkmsg') {
                    const identityKey = extractIdentityFromPkmsg(ciphertext);
                    if (identityKey) {
                        const addrStr = addr.toString();
                        const identityChanged = yield storage.saveIdentity(addrStr, identityKey);
                        if (identityChanged) {
                            logger.info({ jid, addr: addrStr }, 'identity key changed or new contact, session will be re-established');
                        }
                    }
                }
                function doDecrypt() {
                    return __awaiter(this, void 0, void 0, function* () {
                        let result;
                        switch (type) {
                            case 'pkmsg':
                                result = yield session.decryptPreKeyWhisperMessage(ciphertext);
                                break;
                            case 'msg':
                                result = yield session.decryptWhisperMessage(ciphertext);
                                break;
                        }
                        return result;
                    });
                }
                // If it's not a sync message, we need to ensure atomicity
                // For regular messages, we use a transaction to ensure atomicity
                return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                    return yield doDecrypt();
                }), jid);
            });
        },
        encryptMessage(_a) {
            return __awaiter(this, arguments, void 0, function* ({ jid, data }) {
                const addr = jidToSignalProtocolAddress(jid);
                const cipher = new libsignal.SessionCipher(storage, addr);
                // Use transaction to ensure atomicity
                return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                    const { type: sigType, body } = yield cipher.encrypt(data);
                    const type = sigType === 3 ? 'pkmsg' : 'msg';
                    return { type, ciphertext: Buffer.from(body, 'binary') };
                }), jid);
            });
        },
        encryptGroupMessage(_a) {
            return __awaiter(this, arguments, void 0, function* ({ group, meId, data }) {
                const senderName = jidToSignalSenderKeyName(group, meId);
                const builder = new GroupSessionBuilder(storage);
                const senderNameStr = senderName.toString();
                return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                    const { [senderNameStr]: senderKey } = yield auth.keys.get('sender-key', [senderNameStr]);
                    if (!senderKey) {
                        yield storage.storeSenderKey(senderName, new SenderKeyRecord());
                    }
                    const senderKeyDistributionMessage = yield builder.create(senderName);
                    const session = new GroupCipher(storage, senderName);
                    const ciphertext = yield session.encrypt(data);
                    return {
                        ciphertext,
                        senderKeyDistributionMessage: senderKeyDistributionMessage.serialize()
                    };
                }), group);
            });
        },
        injectE2ESession(_a) {
            return __awaiter(this, arguments, void 0, function* ({ jid, session }) {
                logger.trace({ jid }, 'injecting E2EE session');
                const cipher = new libsignal.SessionBuilder(storage, jidToSignalProtocolAddress(jid));
                return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                    yield cipher.initOutgoing(session);
                }), jid);
            });
        },
        jidToSignalProtocolAddress(jid) {
            return jidToSignalProtocolAddress(jid).toString();
        },
        // Optimized direct access to LID mapping store
        lidMapping,
        validateSession(jid) {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    const addr = jidToSignalProtocolAddress(jid);
                    const session = yield storage.loadSession(addr.toString());
                    if (!session) {
                        return { exists: false, reason: 'no session' };
                    }
                    if (!session.haveOpenSession()) {
                        return { exists: false, reason: 'no open session' };
                    }
                    return { exists: true };
                }
                catch (error) {
                    return { exists: false, reason: 'validation error' };
                }
            });
        },
        deleteSession(jids) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!jids.length)
                    return;
                // Convert JIDs to signal addresses and prepare for bulk deletion
                const sessionUpdates = {};
                jids.forEach(jid => {
                    const addr = jidToSignalProtocolAddress(jid);
                    sessionUpdates[addr.toString()] = null;
                });
                // Single transaction for all deletions
                return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                    yield auth.keys.set({ session: sessionUpdates });
                }), `delete-${jids.length}-sessions`);
            });
        },
        migrateSession(fromJid, toJid) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                // TODO: use usync to handle this entire mess
                if (!fromJid || (!isLidUser(toJid) && !isHostedLidUser(toJid)))
                    return { migrated: 0, skipped: 0, total: 0 };
                // Only support PN to LID migration
                if (!isPnUser(fromJid) && !isHostedPnUser(fromJid)) {
                    return { migrated: 0, skipped: 0, total: 1 };
                }
                const { user } = jidDecode(fromJid);
                logger.debug({ fromJid }, 'bulk device migration - loading all user devices');
                // Get user's device list from storage
                const { [user]: userDevices } = yield parsedKeys.get('device-list', [user]);
                if (!userDevices) {
                    return { migrated: 0, skipped: 0, total: 0 };
                }
                const { device: fromDevice } = jidDecode(fromJid);
                const fromDeviceStr = (fromDevice === null || fromDevice === void 0 ? void 0 : fromDevice.toString()) || '0';
                if (!userDevices.includes(fromDeviceStr)) {
                    userDevices.push(fromDeviceStr);
                }
                // Filter out cached devices before database fetch
                const uncachedDevices = userDevices.filter(device => {
                    const deviceKey = `${user}.${device}`;
                    return !migratedSessionCache.has(deviceKey);
                });
                // Bulk check session existence only for uncached devices
                const deviceSessionKeys = uncachedDevices.map(device => `${user}.${device}`);
                const existingSessions = yield parsedKeys.get('session', deviceSessionKeys);
                // Step 3: Convert existing sessions to JIDs (only migrate sessions that exist)
                const deviceJids = [];
                for (const [sessionKey, sessionData] of Object.entries(existingSessions)) {
                    if (sessionData) {
                        // Session exists in storage
                        const deviceStr = sessionKey.split('.')[1];
                        if (!deviceStr)
                            continue;
                        const deviceNum = parseInt(deviceStr);
                        let jid = deviceNum === 0 ? `${user}@s.whatsapp.net` : `${user}:${deviceNum}@s.whatsapp.net`;
                        if (deviceNum === 99) {
                            jid = `${user}:99@hosted`;
                        }
                        deviceJids.push(jid);
                    }
                }
                logger.debug({
                    fromJid,
                    totalDevices: userDevices.length,
                    devicesWithSessions: deviceJids.length,
                    devices: deviceJids
                }, 'bulk device migration complete - all user devices processed');
                // Single transaction for all migrations
                return parsedKeys.transaction(() => __awaiter(this, void 0, void 0, function* () {
                    const migrationOps = deviceJids.map(jid => {
                        const lidWithDevice = transferDevice(jid, toJid);
                        const fromDecoded = jidDecode(jid);
                        const toDecoded = jidDecode(lidWithDevice);
                        return {
                            fromJid: jid,
                            toJid: lidWithDevice,
                            pnUser: fromDecoded.user,
                            lidUser: toDecoded.user,
                            deviceId: fromDecoded.device || 0,
                            fromAddr: jidToSignalProtocolAddress(jid),
                            toAddr: jidToSignalProtocolAddress(lidWithDevice)
                        };
                    });
                    const totalOps = migrationOps.length;
                    let migratedCount = 0;
                    // Bulk fetch PN sessions - already exist (verified during device discovery)
                    const pnAddrStrings = Array.from(new Set(migrationOps.map(op => op.fromAddr.toString())));
                    const pnSessions = yield parsedKeys.get('session', pnAddrStrings);
                    // Prepare bulk session updates (PN → LID migration + deletion)
                    const sessionUpdates = {};
                    for (const op of migrationOps) {
                        const pnAddrStr = op.fromAddr.toString();
                        const lidAddrStr = op.toAddr.toString();
                        const pnSession = pnSessions[pnAddrStr];
                        if (pnSession) {
                            // Session exists (guaranteed from device discovery)
                            const fromSession = libsignal.SessionRecord.deserialize(pnSession);
                            if (fromSession.haveOpenSession()) {
                                // Queue for bulk update: copy to LID, delete from PN
                                sessionUpdates[lidAddrStr] = fromSession.serialize();
                                sessionUpdates[pnAddrStr] = null;
                                migratedCount++;
                            }
                        }
                    }
                    // Single bulk session update for all migrations
                    if (Object.keys(sessionUpdates).length > 0) {
                        yield parsedKeys.set({ session: sessionUpdates });
                        logger.debug({ migratedSessions: migratedCount }, 'bulk session migration complete');
                        // Cache device-level migrations
                        for (const op of migrationOps) {
                            if (sessionUpdates[op.toAddr.toString()]) {
                                const deviceKey = `${op.pnUser}.${op.deviceId}`;
                                migratedSessionCache.set(deviceKey, true);
                            }
                        }
                    }
                    const skippedCount = totalOps - migratedCount;
                    return { migrated: migratedCount, skipped: skippedCount, total: totalOps };
                }), `migrate-${deviceJids.length}-sessions-${(_a = jidDecode(toJid)) === null || _a === void 0 ? void 0 : _a.user}`);
            });
        }
    };
    return repository;
}
const jidToSignalProtocolAddress = (jid) => {
    const decoded = jidDecode(jid);
    const { user, device, server, domainType } = decoded;
    if (!user) {
        throw new Error(`JID decoded but user is empty: "${jid}" -> user: "${user}", server: "${server}", device: ${device}`);
    }
    const signalUser = domainType !== WAJIDDomains.WHATSAPP ? `${user}_${domainType}` : user;
    const finalDevice = device || 0;
    if (device === 99 && decoded.server !== 'hosted' && decoded.server !== 'hosted.lid') {
        throw new Error('Unexpected non-hosted device JID with device 99. This ID seems invalid. ID:' + jid);
    }
    return new libsignal.ProtocolAddress(signalUser, finalDevice);
};
const jidToSignalSenderKeyName = (group, user) => {
    return new SenderKeyName(group, jidToSignalProtocolAddress(user));
};
function signalStorage({ creds, keys }, lidMapping) {
    // Shared function to resolve PN signal address to LID if mapping exists
    const resolveLIDSignalAddress = (id) => __awaiter(this, void 0, void 0, function* () {
        if (id.includes('.')) {
            const [deviceId, device] = id.split('.');
            const [user, domainType_] = deviceId.split('_');
            const domainType = parseInt(domainType_ || '0');
            if (domainType === WAJIDDomains.LID || domainType === WAJIDDomains.HOSTED_LID)
                return id;
            const pnJid = `${user}${device !== '0' ? `:${device}` : ''}@${domainType === WAJIDDomains.HOSTED ? 'hosted' : 's.whatsapp.net'}`;
            const lidForPN = yield lidMapping.getLIDForPN(pnJid);
            if (lidForPN) {
                const lidAddr = jidToSignalProtocolAddress(lidForPN);
                return lidAddr.toString();
            }
        }
        return id;
    });
    return {
        loadSession: (id) => __awaiter(this, void 0, void 0, function* () {
            try {
                const wireJid = yield resolveLIDSignalAddress(id);
                const { [wireJid]: sess } = yield keys.get('session', [wireJid]);
                if (sess) {
                    return libsignal.SessionRecord.deserialize(sess);
                }
            }
            catch (e) {
                return null;
            }
            return null;
        }),
        storeSession: (id, session) => __awaiter(this, void 0, void 0, function* () {
            const wireJid = yield resolveLIDSignalAddress(id);
            yield keys.set({ session: { [wireJid]: session.serialize() } });
        }),
        isTrustedIdentity: () => {
            return true; // TOFU - Trust on First Use (same as WhatsApp Web)
        },
        loadIdentityKey: (id) => __awaiter(this, void 0, void 0, function* () {
            const wireJid = yield resolveLIDSignalAddress(id);
            const { [wireJid]: key } = yield keys.get('identity-key', [wireJid]);
            return key || undefined;
        }),
        saveIdentity: (id, identityKey) => __awaiter(this, void 0, void 0, function* () {
            const wireJid = yield resolveLIDSignalAddress(id);
            const { [wireJid]: existingKey } = yield keys.get('identity-key', [wireJid]);
            const keysMatch = existingKey &&
                existingKey.length === identityKey.length &&
                existingKey.every((byte, i) => byte === identityKey[i]);
            if (existingKey && !keysMatch) {
                // Identity changed - clear session and update key
                yield keys.set({
                    session: { [wireJid]: null },
                    'identity-key': { [wireJid]: identityKey }
                });
                return true;
            }
            if (!existingKey) {
                // New contact - Trust on First Use (TOFU)
                yield keys.set({ 'identity-key': { [wireJid]: identityKey } });
                return true;
            }
            return false;
        }),
        loadPreKey: (id) => __awaiter(this, void 0, void 0, function* () {
            const keyId = id.toString();
            const { [keyId]: key } = yield keys.get('pre-key', [keyId]);
            if (key) {
                return {
                    privKey: Buffer.from(key.private),
                    pubKey: Buffer.from(key.public)
                };
            }
        }),
        removePreKey: (id) => keys.set({ 'pre-key': { [id]: null } }),
        loadSignedPreKey: () => {
            const key = creds.signedPreKey;
            return {
                privKey: Buffer.from(key.keyPair.private),
                pubKey: Buffer.from(key.keyPair.public)
            };
        },
        loadSenderKey: (senderKeyName) => __awaiter(this, void 0, void 0, function* () {
            const keyId = senderKeyName.toString();
            const { [keyId]: key } = yield keys.get('sender-key', [keyId]);
            if (key) {
                return SenderKeyRecord.deserialize(key);
            }
            return new SenderKeyRecord();
        }),
        storeSenderKey: (senderKeyName, key) => __awaiter(this, void 0, void 0, function* () {
            const keyId = senderKeyName.toString();
            const serialized = JSON.stringify(key.serialize());
            yield keys.set({ 'sender-key': { [keyId]: Buffer.from(serialized, 'utf-8') } });
        }),
        getOurRegistrationId: () => creds.registrationId,
        getOurIdentity: () => {
            const { signedIdentityKey } = creds;
            return {
                privKey: Buffer.from(signedIdentityKey.private),
                pubKey: Buffer.from(generateSignalPubKey(signedIdentityKey.public))
            };
        }
    };
}
