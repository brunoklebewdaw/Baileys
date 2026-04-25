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
import { parseAndInjectE2ESessions } from '../../Utils/signal'
describe('parseAndInjectE2ESessions', () => {
	it('should process all user node', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const mockRepository = {
				injectE2ESession: jest.fn()
			}
			mockRepository.injectE2ESession.mockResolvedValue(undefined)
			const createUserNode = jid => ({
				tag: 'user',
				attrs: { jid },
				content: [
					{
						tag: 'skey',
						attrs: {},
						content: [
							{ tag: 'id', attrs: {}, content: Buffer.from([0, 0, 1]) },
							{ tag: 'value', attrs: {}, content: Buffer.alloc(33) },
							{ tag: 'signature', attrs: {}, content: Buffer.alloc(64) }
						]
					},
					{
						tag: 'key',
						attrs: {},
						content: [
							{ tag: 'id', attrs: {}, content: Buffer.from([0, 0, 2]) },
							{ tag: 'value', attrs: {}, content: Buffer.alloc(33) }
						]
					},
					{ tag: 'identity', attrs: {}, content: Buffer.alloc(32) },
					{ tag: 'registration', attrs: {}, content: Buffer.alloc(4) }
				]
			})
			const mockNode = {
				tag: 'iq',
				attrs: {},
				content: [
					{
						tag: 'list',
						attrs: {},
						content: [
							createUserNode('user1@s.whatsapp.net'),
							createUserNode('user2@s.whatsapp.net'),
							createUserNode('user3@s.whatsapp.net')
						]
					}
				]
			}
			yield parseAndInjectE2ESessions(mockNode, mockRepository)
			expect(mockRepository.injectE2ESession).toHaveBeenCalledTimes(3)
			expect(mockRepository.injectE2ESession).toHaveBeenCalledWith(
				expect.objectContaining({ jid: 'user1@s.whatsapp.net' })
			)
			expect(mockRepository.injectE2ESession).toHaveBeenCalledWith(
				expect.objectContaining({ jid: 'user2@s.whatsapp.net' })
			)
			expect(mockRepository.injectE2ESession).toHaveBeenCalledWith(
				expect.objectContaining({ jid: 'user3@s.whatsapp.net' })
			)
		}))
})
