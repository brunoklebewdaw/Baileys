var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as keyhelper from './keyhelper';
import { SenderKeyDistributionMessage } from './sender-key-distribution-message';
export class GroupSessionBuilder {
    constructor(senderKeyStore) {
        this.senderKeyStore = senderKeyStore;
    }
    process(senderKeyName, senderKeyDistributionMessage) {
        return __awaiter(this, void 0, void 0, function* () {
            const senderKeyRecord = yield this.senderKeyStore.loadSenderKey(senderKeyName);
            senderKeyRecord.addSenderKeyState(senderKeyDistributionMessage.getId(), senderKeyDistributionMessage.getIteration(), senderKeyDistributionMessage.getChainKey(), senderKeyDistributionMessage.getSignatureKey());
            yield this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord);
        });
    }
    create(senderKeyName) {
        return __awaiter(this, void 0, void 0, function* () {
            const senderKeyRecord = yield this.senderKeyStore.loadSenderKey(senderKeyName);
            if (senderKeyRecord.isEmpty()) {
                const keyId = keyhelper.generateSenderKeyId();
                const senderKey = keyhelper.generateSenderKey();
                const signingKey = keyhelper.generateSenderSigningKey();
                senderKeyRecord.setSenderKeyState(keyId, 0, senderKey, signingKey);
                yield this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord);
            }
            const state = senderKeyRecord.getSenderKeyState();
            if (!state) {
                throw new Error('No session state available');
            }
            return new SenderKeyDistributionMessage(state.getKeyId(), state.getSenderChainKey().getIteration(), state.getSenderChainKey().getSeed(), state.getSigningKeyPublic());
        });
    }
}
