import { jest } from '@jest/globals';
import P from 'pino';
import { LIDMappingStore } from '../../Signal/lid-mapping';
const HOSTED_DEVICE_ID = 99;
const mockKeys = {
    get: jest.fn(),
    set: jest.fn(),
    transaction: jest.fn(async (work) => await work()),
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
        it('should correctly map a standard LID with a hosted device ID back to a standard PN with a hosted device', async () => {
            const lidWithHostedDevice = `12345:${HOSTED_DEVICE_ID}@lid`;
            const pnUser = '54321';
            // @ts-ignore
            mockKeys.get.mockResolvedValue({ [`12345_reverse`]: pnUser });
            const result = await lidMappingStore.getPNForLID(lidWithHostedDevice);
            expect(result).toBe(`${pnUser}:${HOSTED_DEVICE_ID}@s.whatsapp.net`);
        });
        it('should return null if no reverse mapping is found', async () => {
            const lid = 'nonexistent@lid';
            // @ts-ignore
            mockKeys.get.mockResolvedValue({}); // Simulate not found in DB
            const result = await lidMappingStore.getPNForLID(lid);
            expect(result).toBeNull();
        });
    });
});
//# sourceMappingURL=lid-mapping.test.js.map