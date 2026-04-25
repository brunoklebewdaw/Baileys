var __awaiter =
	(this && this.__awaiter) ||
	function (thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P
				? value
				: new P(function (resolve) {
						resolve(value)
					})
		}
		return new (P || (P = Promise))(function (resolve, reject) {
			function fulfilled(value) {
				try {
					step(generator.next(value))
				} catch (e) {
					reject(e)
				}
			}
			function rejected(value) {
				try {
					step(generator['throw'](value))
				} catch (e) {
					reject(e)
				}
			}
			function step(result) {
				result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected)
			}
			step((generator = generator.apply(thisArg, _arguments || [])).next())
		})
	}
import { jest } from '@jest/globals'
import { proto } from '../..'
import { DEFAULT_CONNECTION_CONFIG } from '../../Defaults'
import makeWASocket from '../../Socket'
import { makeSession, mockWebSocket } from '../TestUtils/session'
mockWebSocket()
describe('Connection Deadlock Test', () => {
	it('should not deadlock when history sync is disabled', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const { state, clear } = yield makeSession()
			state.creds.me = { id: '1234567890:1@s.whatsapp.net', name: 'Test User' }
			const sock = makeWASocket(
				Object.assign(Object.assign({}, DEFAULT_CONNECTION_CONFIG), {
					auth: state,
					shouldSyncHistoryMessage: () => false
				})
			)
			const regularMessageListener = jest.fn()
			sock.ev.on('messages.upsert', regularMessageListener)
			// 1. Simulate receiving pending notifications. This activates the buffer.
			sock.ev.emit('connection.update', { receivedPendingNotifications: true })
			// 2. Now, emit a regular message. Because the previous step should have
			// flushed the buffer, this message should be processed immediately.
			const regularMessage = proto.WebMessageInfo.fromObject({
				key: { remoteJid: '1234567890@s.whatsapp.net', fromMe: false, id: 'REGULAR_MSG_1' },
				messageTimestamp: Date.now() / 1000,
				message: { conversation: 'Hello, world!' }
			})
			sock.ev.emit('messages.upsert', { messages: [regularMessage], type: 'notify' })
			// Wait for the event loop to process any final events.
			yield new Promise(resolve => setTimeout(resolve, 50))
			// 3. Check if the regular message listener was called.
			expect(regularMessageListener).toHaveBeenCalledTimes(1)
			expect(regularMessageListener).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: expect.arrayContaining([
						expect.objectContaining({
							key: regularMessage.key
						})
					]),
					type: 'notify'
				})
			)
			yield sock.end(new Error('Test completed'))
			yield clear()
		}))
})
