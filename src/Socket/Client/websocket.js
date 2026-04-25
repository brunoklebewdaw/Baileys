var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import WebSocket from 'ws';
import { DEFAULT_ORIGIN } from '../../Defaults';
import { AbstractSocketClient } from './types';
export class WebSocketClient extends AbstractSocketClient {
    constructor() {
        super(...arguments);
        this.socket = null;
    }
    get isOpen() {
        var _a;
        return ((_a = this.socket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN;
    }
    get isClosed() {
        var _a;
        return this.socket === null || ((_a = this.socket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.CLOSED;
    }
    get isClosing() {
        var _a;
        return this.socket === null || ((_a = this.socket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.CLOSING;
    }
    get isConnecting() {
        var _a;
        return ((_a = this.socket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.CONNECTING;
    }
    connect() {
        var _a, _b;
        if (this.socket) {
            return;
        }
        this.socket = new WebSocket(this.url, {
            origin: DEFAULT_ORIGIN,
            headers: (_a = this.config.options) === null || _a === void 0 ? void 0 : _a.headers,
            handshakeTimeout: this.config.connectTimeoutMs,
            timeout: this.config.connectTimeoutMs,
            agent: this.config.agent
        });
        this.socket.setMaxListeners(0);
        const events = ['close', 'error', 'upgrade', 'message', 'open', 'ping', 'pong', 'unexpected-response'];
        for (const event of events) {
            (_b = this.socket) === null || _b === void 0 ? void 0 : _b.on(event, (...args) => this.emit(event, ...args));
        }
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.socket) {
                return;
            }
            const closePromise = new Promise(resolve => {
                var _a;
                (_a = this.socket) === null || _a === void 0 ? void 0 : _a.once('close', resolve);
            });
            this.socket.close();
            yield closePromise;
            this.socket = null;
        });
    }
    send(str, cb) {
        var _a;
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.send(str, cb);
        return Boolean(this.socket);
    }
}
