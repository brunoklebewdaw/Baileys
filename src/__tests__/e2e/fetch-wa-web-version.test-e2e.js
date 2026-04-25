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
import { fetchLatestWaWebVersion } from '../../Utils/generics'
describe('fetchLatestWaWebVersion Integration Tests', () => {
	jest.setTimeout(10000)
	it('should successfully fetch the latest WhatsApp Web version from real API', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const result = yield fetchLatestWaWebVersion()
			expect(Array.isArray(result.version)).toBe(true)
			expect(result.version).toHaveLength(3)
			expect(typeof result.version[0]).toBe('number')
			expect(typeof result.version[1]).toBe('number')
			expect(typeof result.version[2]).toBe('number')
			expect(typeof result.isLatest).toBe('boolean')
			if (!result.isLatest) {
				expect(result.error).toBeDefined()
			}
		}))
	it('should handle custom headers correctly', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const customHeaders = {
				accept:
					'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
				'accept-language': 'en-US,en;q=0.9',
				'cache-control': 'max-age=0',
				'sec-ch-prefers-color-scheme': 'dark',
				'sec-fetch-dest': 'document',
				'sec-fetch-mode': 'navigate',
				'sec-fetch-site': 'none',
				'upgrade-insecure-requests': '1'
			}
			const result = yield fetchLatestWaWebVersion({
				headers: customHeaders
			})
			expect(Array.isArray(result.version)).toBe(true)
			expect(result.version).toHaveLength(3)
			expect(result.isLatest).toBe(true)
		}))
	it('should fallback gracefully when client_revision is not found', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const result = yield fetchLatestWaWebVersion()
			expect(result).toHaveProperty('version')
			expect(result).toHaveProperty('isLatest')
			expect(Array.isArray(result.version)).toBe(true)
		}))
	it('should handle network timeouts gracefully', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const result = yield fetchLatestWaWebVersion()
			expect(result).toHaveProperty('version')
			expect(result).toHaveProperty('isLatest')
			expect(Array.isArray(result.version)).toBe(true)
		}))
})
