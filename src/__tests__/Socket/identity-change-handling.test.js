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
import NodeCache from '@cacheable/node-cache'
import { jest } from '@jest/globals'
import P from 'pino'
import { handleIdentityChange } from '../../Utils/identity-change-handler'
const logger = P({ level: 'silent' })
describe('Identity Change Handling', () => {
	let mockValidateSession
	let mockAssertSessions
	let identityAssertDebounce
	let mockMeId
	let mockMeLid
	function createIdentityChangeNode(from, offline) {
		return {
			tag: 'notification',
			attrs: Object.assign({ from, type: 'encrypt' }, offline !== undefined ? { offline } : {}),
			content: [
				{
					tag: 'identity',
					attrs: {},
					content: Buffer.from('test-identity-key')
				}
			]
		}
	}
	function createContext() {
		return {
			meId: mockMeId,
			meLid: mockMeLid,
			validateSession: mockValidateSession,
			assertSessions: mockAssertSessions,
			debounceCache: identityAssertDebounce,
			logger
		}
	}
	beforeEach(() => {
		jest.clearAllMocks()
		mockValidateSession = jest.fn()
		mockAssertSessions = jest.fn()
		identityAssertDebounce = new NodeCache({ stdTTL: 5, useClones: false })
		mockMeId = 'myuser@s.whatsapp.net'
		mockMeLid = 'mylid@lid'
	})
	describe('Core Checks', () => {
		it('should skip companion devices (device > 0)', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				const node = createIdentityChangeNode('user:5@s.whatsapp.net')
				const result = yield handleIdentityChange(node, createContext())
				expect(mockValidateSession).not.toHaveBeenCalled()
				expect(result.action).toBe('skipped_companion_device')
			}))
		it('should process primary device (device 0 or undefined)', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				mockAssertSessions.mockResolvedValue(true)
				const node = createIdentityChangeNode('user@s.whatsapp.net')
				const result = yield handleIdentityChange(node, createContext())
				expect(result.action).toBe('session_refreshed')
			}))
		it('should skip self-primary identity (PN match)', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				const node = createIdentityChangeNode('myuser@s.whatsapp.net')
				const result = yield handleIdentityChange(node, createContext())
				expect(mockValidateSession).not.toHaveBeenCalled()
				expect(result.action).toBe('skipped_self_primary')
			}))
		it('should skip self-primary identity (LID match)', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				const node = createIdentityChangeNode('mylid@lid')
				const result = yield handleIdentityChange(node, createContext())
				expect(mockValidateSession).not.toHaveBeenCalled()
				expect(result.action).toBe('skipped_self_primary')
			}))
		it('should skip when no existing session', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: false })
				const node = createIdentityChangeNode('user@s.whatsapp.net')
				const result = yield handleIdentityChange(node, createContext())
				expect(mockAssertSessions).not.toHaveBeenCalled()
				expect(result.action).toBe('skipped_no_session')
			}))
		it('should skip session refresh during offline processing', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				const node = createIdentityChangeNode('user@s.whatsapp.net', '0')
				const result = yield handleIdentityChange(node, createContext())
				expect(mockAssertSessions).not.toHaveBeenCalled()
				expect(result.action).toBe('skipped_offline')
			}))
		it('should refresh session when online with existing session', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				mockAssertSessions.mockResolvedValue(true)
				const node = createIdentityChangeNode('user@s.whatsapp.net')
				const result = yield handleIdentityChange(node, createContext())
				expect(mockAssertSessions).toHaveBeenCalledWith(['user@s.whatsapp.net'], true)
				expect(result.action).toBe('session_refreshed')
			}))
	})
	describe('Debounce', () => {
		it('should debounce multiple identity changes for the same JID', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				mockAssertSessions.mockResolvedValue(true)
				const node = createIdentityChangeNode('user@s.whatsapp.net')
				const result1 = yield handleIdentityChange(node, createContext())
				expect(result1.action).toBe('session_refreshed')
				const result2 = yield handleIdentityChange(node, createContext())
				expect(result2.action).toBe('debounced')
				expect(mockAssertSessions).toHaveBeenCalledTimes(1)
			}))
		it('should allow different JIDs to process independently', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				mockAssertSessions.mockResolvedValue(true)
				const result1 = yield handleIdentityChange(createIdentityChangeNode('user1@s.whatsapp.net'), createContext())
				const result2 = yield handleIdentityChange(createIdentityChangeNode('user2@s.whatsapp.net'), createContext())
				expect(result1.action).toBe('session_refreshed')
				expect(result2.action).toBe('session_refreshed')
				expect(mockAssertSessions).toHaveBeenCalledTimes(2)
			}))
	})
	describe('Error Handling', () => {
		it('should handle assertSessions failure gracefully', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				const testError = new Error('Session assertion failed')
				mockAssertSessions.mockRejectedValue(testError)
				const node = createIdentityChangeNode('user@s.whatsapp.net')
				const result = yield handleIdentityChange(node, createContext())
				expect(result.action).toBe('session_refresh_failed')
				expect(result.error).toBe(testError)
			}))
		it('should propagate validateSession errors', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockRejectedValue(new Error('Database error'))
				const node = createIdentityChangeNode('user@s.whatsapp.net')
				yield expect(handleIdentityChange(node, createContext())).rejects.toThrow('Database error')
			}))
	})
	describe('Edge Cases', () => {
		it('should return invalid_notification when from is missing', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				const node = {
					tag: 'notification',
					attrs: { type: 'encrypt' },
					content: [{ tag: 'identity', attrs: {}, content: Buffer.from('key') }]
				}
				const result = yield handleIdentityChange(node, createContext())
				expect(result.action).toBe('invalid_notification')
			}))
		it('should return no_identity_node when identity child is missing', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				const node = {
					tag: 'notification',
					attrs: { from: 'user@s.whatsapp.net', type: 'encrypt' },
					content: []
				}
				const result = yield handleIdentityChange(node, createContext())
				expect(result.action).toBe('no_identity_node')
			}))
		it('should handle LID JIDs correctly', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				mockAssertSessions.mockResolvedValue(true)
				const node = createIdentityChangeNode('12345@lid')
				const result = yield handleIdentityChange(node, createContext())
				expect(mockValidateSession).toHaveBeenCalledWith('12345@lid')
				expect(result.action).toBe('session_refreshed')
			}))
	})
	describe('onBeforeSessionRefresh callback', () => {
		it('fires before assertSessions when a session refresh is about to run', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				mockValidateSession.mockResolvedValue({ exists: true })
				const callOrder = []
				mockAssertSessions.mockImplementation(() =>
					__awaiter(void 0, void 0, void 0, function* () {
						callOrder.push('assertSessions')
						return true
					})
				)
				const onBeforeSessionRefresh = jest.fn(jid => {
					callOrder.push(`before:${jid}`)
				})
				const node = createIdentityChangeNode('user@s.whatsapp.net')
				const ctx = Object.assign(Object.assign({}, createContext()), { onBeforeSessionRefresh })
				const result = yield handleIdentityChange(node, ctx)
				expect(result.action).toBe('session_refreshed')
				expect(callOrder).toEqual(['before:user@s.whatsapp.net', 'assertSessions'])
			}))
		it('does not fire when the refresh is skipped (no session / offline / self)', () =>
			__awaiter(void 0, void 0, void 0, function* () {
				const onBeforeSessionRefresh = jest.fn()
				// no session
				mockValidateSession.mockResolvedValue({ exists: false })
				yield handleIdentityChange(
					createIdentityChangeNode('a@s.whatsapp.net'),
					Object.assign(Object.assign({}, createContext()), { onBeforeSessionRefresh })
				)
				// offline
				mockValidateSession.mockResolvedValue({ exists: true })
				yield handleIdentityChange(
					createIdentityChangeNode('b@s.whatsapp.net', '0'),
					Object.assign(Object.assign({}, createContext()), { onBeforeSessionRefresh })
				)
				// self-primary
				yield handleIdentityChange(
					createIdentityChangeNode(mockMeId),
					Object.assign(Object.assign({}, createContext()), { onBeforeSessionRefresh })
				)
				expect(onBeforeSessionRefresh).not.toHaveBeenCalled()
			}))
	})
})
