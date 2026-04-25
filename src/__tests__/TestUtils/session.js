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
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { useMultiFileAuthState } from '../..';
/**
 * Creates a temporary, isolated authentication state for tests.
 * This prevents tests from interfering with each other or with a real session.
 * @returns An object with the authentication state and a cleanup function.
 */
export const makeSession = () => __awaiter(void 0, void 0, void 0, function* () {
    // Create a temporary directory for the session files
    const dir = join(tmpdir(), `baileys-test-session-${Date.now()}`);
    yield fs.mkdir(dir, { recursive: true });
    // Use the multi-file auth state with the temporary directory
    const { state, saveCreds } = yield useMultiFileAuthState(dir);
    return {
        state,
        saveCreds,
        /**
         * Cleans up the temporary session files.
         * Call this at the end of your test.
         */
        clear: () => __awaiter(void 0, void 0, void 0, function* () {
            yield fs.rm(dir, { recursive: true, force: true });
        })
    };
});
export const mockWebSocket = () => {
    jest.mock('../../Socket/Client/websocket', () => {
        return {
            WebSocketClient: jest.fn().mockImplementation(() => ({
                connect: jest.fn(() => Promise.resolve()),
                close: jest.fn(),
                on: jest.fn(),
                off: jest.fn(),
                emit: jest.fn(),
                send: jest.fn(),
                isOpen: true
            }))
        };
    });
};
