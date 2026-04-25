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
import P from 'pino';
import { LIDMappingStore } from '../../Signal/lid-mapping';
const HOSTED_DEVICE_ID = 99;
const mockKeys = {
    get: jest.fn(),
    set: jest.fn(),
    transaction: jest.fn((work) => __awaiter(void 0, void 0, void 0, function* () { return yield work(); })),
    isInTransaction: jest.fn()
};
const logger = P({ level: 'silent' });
describe('LIDMappingStore', () => {
    const mockPnToLIDFunc = jest.fn();
    let lidMappingStore;
    beforeEach(() => {
        jest.clearAllMocks();
        lidMappingStore = new LIDMappingStore(mockKeys, logger, mockPnToLIDFunc);
    });
    describe('getPNForLID', () => {
        it('should correctly map a standard LID with a hosted device ID back to a standard PN with a hosted device', () => __awaiter(void 0, void 0, void 0, function* () {
            const lidWithHostedDevice = `12345:${HOSTED_DEVICE_ID}@lid`;
            const pnUser = '54321';
            // @ts-ignore
            mockKeys.get.mockResolvedValue({ [`12345_reverse`]: pnUser });
            const result = yield lidMappingStore.getPNForLID(lidWithHostedDevice);
            expect(result).toBe(`${pnUser}:${HOSTED_DEVICE_ID}@s.whatsapp.net`);
        }));
        it('should return null if no reverse mapping is found', () => __awaiter(void 0, void 0, void 0, function* () {
            const lid = 'nonexistent@lid';
            // @ts-ignore
            mockKeys.get.mockResolvedValue({}); // Simulate not found in DB
            const result = yield lidMappingStore.getPNForLID(lid);
            expect(result).toBeNull();
        }));
    });
});
