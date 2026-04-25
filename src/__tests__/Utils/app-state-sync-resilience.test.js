var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Boom } from '@hapi/boom';
import { decodeSyncdMutations, decodeSyncdPatch, decodeSyncdSnapshot, isAppStateSyncIrrecoverable, isMissingKeyError, MAX_SYNC_ATTEMPTS, newLTHashState } from '../../Utils/chat-utils';
const missingKeyFn = () => __awaiter(void 0, void 0, void 0, function* () { return null; });
describe('App State Sync', () => {
    describe('missing key errors are marked with isMissingKey (Blocked in WA Web)', () => {
        it('decodeSyncdPatch throws with isMissingKey on missing key', () => __awaiter(void 0, void 0, void 0, function* () {
            const msg = {
                keyId: { id: Buffer.from('missing-key') },
                mutations: [],
                version: { version: 1 },
                snapshotMac: Buffer.alloc(32),
                patchMac: Buffer.alloc(32)
            };
            try {
                yield decodeSyncdPatch(msg, 'regular_low', newLTHashState(), missingKeyFn, () => { }, true);
                fail('should have thrown');
            }
            catch (error) {
                expect(isMissingKeyError(error)).toBe(true);
            }
        }));
        it('decodeSyncdSnapshot throws with isMissingKey on missing snapshot key', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = {
                version: { version: 1 },
                records: [],
                keyId: { id: Buffer.from('missing-key') },
                mac: Buffer.alloc(32)
            };
            try {
                yield decodeSyncdSnapshot('regular_low', snapshot, missingKeyFn, undefined, true);
                fail('should have thrown');
            }
            catch (error) {
                expect(isMissingKeyError(error)).toBe(true);
            }
        }));
        it('decodeSyncdMutations throws with isMissingKey on missing mutation key', () => __awaiter(void 0, void 0, void 0, function* () {
            const records = [
                {
                    keyId: { id: Buffer.from('missing-key') },
                    value: { blob: Buffer.alloc(64) },
                    index: { blob: Buffer.alloc(32) }
                }
            ];
            try {
                yield decodeSyncdMutations(records, newLTHashState(), missingKeyFn, () => { }, true);
                fail('should have thrown');
            }
            catch (error) {
                expect(isMissingKeyError(error)).toBe(true);
            }
        }));
        it('missing key errors are NOT irrecoverable on first attempt', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Boom('missing key', { data: { isMissingKey: true } });
            expect(isMissingKeyError(error)).toBe(true);
            expect(isAppStateSyncIrrecoverable(error, 1)).toBe(false);
        }));
    });
    describe('isAppStateSyncIrrecoverable', () => {
        it('should NOT be irrecoverable for status 400 (dead code path removed)', () => {
            expect(isAppStateSyncIrrecoverable(new Boom('test', { statusCode: 400 }), 1)).toBe(false);
        });
        it('should NOT be irrecoverable for status 404 (missing key is Blocked, not Fatal)', () => {
            expect(isAppStateSyncIrrecoverable(new Boom('test', { statusCode: 404 }), 1)).toBe(false);
        });
        it('should NOT be irrecoverable for status 405', () => {
            expect(isAppStateSyncIrrecoverable(new Boom('test', { statusCode: 405 }), 1)).toBe(false);
        });
        it('should NOT be irrecoverable for status 406', () => {
            expect(isAppStateSyncIrrecoverable(new Boom('test', { statusCode: 406 }), 1)).toBe(false);
        });
        it('should be irrecoverable for TypeError', () => {
            expect(isAppStateSyncIrrecoverable(new TypeError('WASM crash'), 1)).toBe(true);
        });
        it('should be irrecoverable when attempts >= MAX_SYNC_ATTEMPTS', () => {
            expect(isAppStateSyncIrrecoverable(new Error('generic'), MAX_SYNC_ATTEMPTS)).toBe(true);
        });
        it('should NOT be irrecoverable for generic error below max attempts', () => {
            expect(isAppStateSyncIrrecoverable(new Error('generic'), 1)).toBe(false);
        });
        it('should NOT be irrecoverable for non-fatal status codes', () => {
            expect(isAppStateSyncIrrecoverable(new Boom('server error', { statusCode: 500 }), 1)).toBe(false);
        });
        it('should handle null/undefined error gracefully', () => {
            expect(isAppStateSyncIrrecoverable(null, MAX_SYNC_ATTEMPTS)).toBe(true);
            expect(isAppStateSyncIrrecoverable(undefined, 1)).toBe(false);
        });
    });
});
