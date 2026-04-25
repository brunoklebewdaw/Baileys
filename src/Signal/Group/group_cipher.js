var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { decrypt, encrypt } from 'libsignal/src/crypto';
import { SenderKeyMessage } from './sender-key-message';
export class GroupCipher {
    constructor(senderKeyStore, senderKeyName) {
        this.senderKeyStore = senderKeyStore;
        this.senderKeyName = senderKeyName;
    }
    encrypt(paddedPlaintext) {
        return __awaiter(this, void 0, void 0, function* () {
            const record = yield this.senderKeyStore.loadSenderKey(this.senderKeyName);
            if (!record) {
                throw new Error('No SenderKeyRecord found for encryption');
            }
            const senderKeyState = record.getSenderKeyState();
            if (!senderKeyState) {
                throw new Error('No session to encrypt message');
            }
            const iteration = senderKeyState.getSenderChainKey().getIteration();
            const senderKey = this.getSenderKey(senderKeyState, iteration === 0 ? 0 : iteration + 1);
            const ciphertext = yield this.getCipherText(senderKey.getIv(), senderKey.getCipherKey(), paddedPlaintext);
            const senderKeyMessage = new SenderKeyMessage(senderKeyState.getKeyId(), senderKey.getIteration(), ciphertext, senderKeyState.getSigningKeyPrivate());
            yield this.senderKeyStore.storeSenderKey(this.senderKeyName, record);
            return senderKeyMessage.serialize();
        });
    }
    decrypt(senderKeyMessageBytes) {
        return __awaiter(this, void 0, void 0, function* () {
            const record = yield this.senderKeyStore.loadSenderKey(this.senderKeyName);
            if (!record) {
                throw new Error('No SenderKeyRecord found for decryption');
            }
            const senderKeyMessage = new SenderKeyMessage(null, null, null, null, senderKeyMessageBytes);
            const senderKeyState = record.getSenderKeyState(senderKeyMessage.getKeyId());
            if (!senderKeyState) {
                throw new Error('No session found to decrypt message');
            }
            senderKeyMessage.verifySignature(senderKeyState.getSigningKeyPublic());
            const senderKey = this.getSenderKey(senderKeyState, senderKeyMessage.getIteration());
            const plaintext = yield this.getPlainText(senderKey.getIv(), senderKey.getCipherKey(), senderKeyMessage.getCipherText());
            yield this.senderKeyStore.storeSenderKey(this.senderKeyName, record);
            return plaintext;
        });
    }
    getSenderKey(senderKeyState, iteration) {
        let senderChainKey = senderKeyState.getSenderChainKey();
        if (senderChainKey.getIteration() > iteration) {
            if (senderKeyState.hasSenderMessageKey(iteration)) {
                const messageKey = senderKeyState.removeSenderMessageKey(iteration);
                if (!messageKey) {
                    throw new Error('No sender message key found for iteration');
                }
                return messageKey;
            }
            throw new Error(`Received message with old counter: ${senderChainKey.getIteration()}, ${iteration}`);
        }
        if (iteration - senderChainKey.getIteration() > 2000) {
            throw new Error('Over 2000 messages into the future!');
        }
        while (senderChainKey.getIteration() < iteration) {
            senderKeyState.addSenderMessageKey(senderChainKey.getSenderMessageKey());
            senderChainKey = senderChainKey.getNext();
        }
        senderKeyState.setSenderChainKey(senderChainKey.getNext());
        return senderChainKey.getSenderMessageKey();
    }
    getPlainText(iv, key, ciphertext) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return decrypt(key, ciphertext, iv);
            }
            catch (e) {
                throw new Error('InvalidMessageException');
            }
        });
    }
    getCipherText(iv, key, plaintext) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return encrypt(key, plaintext, iv);
            }
            catch (e) {
                throw new Error('InvalidMessageException');
            }
        });
    }
}
