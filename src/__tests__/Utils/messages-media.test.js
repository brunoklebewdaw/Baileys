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
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { Readable } from 'stream'
import { encryptedStream, uploadWithNodeHttp } from '../../Utils/messages-media'
const createTempFile = content =>
	__awaiter(void 0, void 0, void 0, function* () {
		const filePath = path.join(os.tmpdir(), `test-upload-${Date.now()}.txt`)
		yield fs.promises.writeFile(filePath, content)
		return filePath
	})
const cleanupTempFile = filePath =>
	__awaiter(void 0, void 0, void 0, function* () {
		try {
			yield fs.promises.unlink(filePath)
		} catch (_a) {}
	})
describe('uploadWithNodeHttp', () => {
	let server
	let serverPort
	let tempFilePath
	const testFileContent = 'Hello, this is test content for upload!'
	beforeAll(() =>
		__awaiter(void 0, void 0, void 0, function* () {
			tempFilePath = yield createTempFile(testFileContent)
		})
	)
	afterAll(() =>
		__awaiter(void 0, void 0, void 0, function* () {
			yield cleanupTempFile(tempFilePath)
		})
	)
	afterEach(() => {
		if (server) {
			server.close()
		}
	})
	const startServer = handler => {
		return new Promise(resolve => {
			server = http.createServer(handler)
			server.listen(0, () => {
				const address = server.address()
				if (address && typeof address === 'object') {
					serverPort = address.port
					resolve(serverPort)
				}
			})
		})
	}
	it('should successfully upload a file and receive JSON response', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const expectedResponse = { url: 'https://example.com/media/123', direct_path: '/media/123' }
			let receivedBody = ''
			yield startServer((req, res) => {
				req.on('data', chunk => {
					receivedBody += chunk
				})
				req.on('end', () => {
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify(expectedResponse))
				})
			})
			const params = {
				url: `http://localhost:${serverPort}/upload`,
				filePath: tempFilePath,
				headers: { 'Content-Type': 'application/octet-stream' }
			}
			const result = yield uploadWithNodeHttp(params)
			expect(result).toEqual(expectedResponse)
			expect(receivedBody).toBe(testFileContent)
		}))
	it('should follow a single redirect (302)', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const expectedResponse = { url: 'https://example.com/media/456', direct_path: '/media/456' }
			let requestCount = 0
			yield startServer((req, res) => {
				requestCount++
				if (req.url === '/upload') {
					res.writeHead(302, { Location: `http://localhost:${serverPort}/final` })
					res.end()
				} else if (req.url === '/final') {
					let body = ''
					req.on('data', chunk => (body += chunk))
					req.on('end', () => {
						res.writeHead(200, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify(expectedResponse))
					})
				}
			})
			const params = {
				url: `http://localhost:${serverPort}/upload`,
				filePath: tempFilePath,
				headers: { 'Content-Type': 'application/octet-stream' }
			}
			const result = yield uploadWithNodeHttp(params)
			expect(result).toEqual(expectedResponse)
			expect(requestCount).toBe(2)
		}))
	it('should follow multiple redirects (301 -> 302 -> 200)', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const expectedResponse = { url: 'https://example.com/media/789', direct_path: '/media/789' }
			let requestCount = 0
			yield startServer((req, res) => {
				requestCount++
				if (req.url === '/upload') {
					res.writeHead(301, { Location: `http://localhost:${serverPort}/redirect1` })
					res.end()
				} else if (req.url === '/redirect1') {
					res.writeHead(302, { Location: `http://localhost:${serverPort}/redirect2` })
					res.end()
				} else if (req.url === '/redirect2') {
					res.writeHead(307, { Location: `http://localhost:${serverPort}/final` })
					res.end()
				} else if (req.url === '/final') {
					let body = ''
					req.on('data', chunk => (body += chunk))
					req.on('end', () => {
						res.writeHead(200, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify(expectedResponse))
					})
				}
			})
			const params = {
				url: `http://localhost:${serverPort}/upload`,
				filePath: tempFilePath,
				headers: { 'Content-Type': 'application/octet-stream' }
			}
			const result = yield uploadWithNodeHttp(params)
			expect(result).toEqual(expectedResponse)
			expect(requestCount).toBe(4)
		}))
	it('should throw error on too many redirects (more than 5)', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			yield startServer((req, res) => {
				var _a
				const currentNum = parseInt(
					((_a = req.url) === null || _a === void 0 ? void 0 : _a.replace('/redirect', '')) || '0'
				)
				res.writeHead(302, { Location: `http://localhost:${serverPort}/redirect${currentNum + 1}` })
				res.end()
			})
			const params = {
				url: `http://localhost:${serverPort}/redirect0`,
				filePath: tempFilePath,
				headers: { 'Content-Type': 'application/octet-stream' }
			}
			yield expect(uploadWithNodeHttp(params)).rejects.toThrow('Too many redirects')
		}))
	it('should return undefined for non-JSON response', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			yield startServer((req, res) => {
				let body = ''
				req.on('data', chunk => (body += chunk))
				req.on('end', () => {
					res.writeHead(200, { 'Content-Type': 'text/html' })
					res.end('<html>Not JSON</html>')
				})
			})
			const params = {
				url: `http://localhost:${serverPort}/upload`,
				filePath: tempFilePath,
				headers: { 'Content-Type': 'application/octet-stream' }
			}
			const result = yield uploadWithNodeHttp(params)
			expect(result).toBeUndefined()
		}))
	it('should handle relative redirect URLs', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const expectedResponse = { url: 'https://example.com/media/rel', direct_path: '/media/rel' }
			let requestCount = 0
			yield startServer((req, res) => {
				requestCount++
				if (req.url === '/upload') {
					res.writeHead(302, { Location: '/final' })
					res.end()
				} else if (req.url === '/final') {
					let body = ''
					req.on('data', chunk => (body += chunk))
					req.on('end', () => {
						res.writeHead(200, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify(expectedResponse))
					})
				}
			})
			const params = {
				url: `http://localhost:${serverPort}/upload`,
				filePath: tempFilePath,
				headers: { 'Content-Type': 'application/octet-stream' }
			}
			const result = yield uploadWithNodeHttp(params)
			expect(result).toEqual(expectedResponse)
			expect(requestCount).toBe(2)
		}))
	it('should preserve headers on redirect', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const expectedResponse = { success: true }
			let capturedHeaders
			yield startServer((req, res) => {
				if (req.url === '/upload') {
					res.writeHead(302, { Location: `http://localhost:${serverPort}/final` })
					res.end()
				} else if (req.url === '/final') {
					capturedHeaders = req.headers
					let body = ''
					req.on('data', chunk => (body += chunk))
					req.on('end', () => {
						res.writeHead(200, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify(expectedResponse))
					})
				}
			})
			const customHeaders = {
				'Content-Type': 'application/octet-stream',
				'X-Custom-Header': 'test-value',
				Authorization: 'Bearer token123'
			}
			const params = {
				url: `http://localhost:${serverPort}/upload`,
				filePath: tempFilePath,
				headers: customHeaders
			}
			const result = yield uploadWithNodeHttp(params)
			expect(result).toEqual(expectedResponse)
			expect(capturedHeaders === null || capturedHeaders === void 0 ? void 0 : capturedHeaders['x-custom-header']).toBe(
				'test-value'
			)
			expect(capturedHeaders === null || capturedHeaders === void 0 ? void 0 : capturedHeaders['authorization']).toBe(
				'Bearer token123'
			)
		}))
	it('should re-stream file content on redirect', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const expectedResponse = { success: true }
			let finalReceivedBody = ''
			yield startServer((req, res) => {
				if (req.url === '/upload') {
					req.on('data', () => {})
					req.on('end', () => {
						res.writeHead(302, { Location: `http://localhost:${serverPort}/final` })
						res.end()
					})
				} else if (req.url === '/final') {
					req.on('data', chunk => {
						finalReceivedBody += chunk
					})
					req.on('end', () => {
						res.writeHead(200, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify(expectedResponse))
					})
				}
			})
			const params = {
				url: `http://localhost:${serverPort}/upload`,
				filePath: tempFilePath,
				headers: { 'Content-Type': 'application/octet-stream' }
			}
			const result = yield uploadWithNodeHttp(params)
			expect(result).toEqual(expectedResponse)
			expect(finalReceivedBody).toBe(testFileContent)
		}))
})
describe('encryptedStream', () => {
	const cleanupFiles = files =>
		__awaiter(void 0, void 0, void 0, function* () {
			for (const file of files) {
				if (file) {
					try {
						yield fs.promises.unlink(file)
					} catch (_a) {}
				}
			}
		})
	it('should encrypt a buffer and return valid result without hanging', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const testData = Buffer.from('Hello, this is test content for encryption!')
			const result = yield encryptedStream(testData, 'image')
			expect(result).toBeDefined()
			expect(result.mediaKey).toBeDefined()
			expect(result.mediaKey.length).toBe(32)
			expect(result.encFilePath).toBeDefined()
			expect(result.fileSha256).toBeDefined()
			expect(result.fileEncSha256).toBeDefined()
			expect(result.mac).toBeDefined()
			expect(result.mac.length).toBe(10)
			expect(result.fileLength).toBe(testData.length)
			const encFileExists = yield fs.promises
				.access(result.encFilePath)
				.then(() => true)
				.catch(() => false)
			expect(encFileExists).toBe(true)
			yield cleanupFiles([result.encFilePath, result.originalFilePath])
		}))
	it('should encrypt a stream and complete without race condition', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const chunks = ['chunk1', 'chunk2', 'chunk3', 'chunk4', 'chunk5']
			const testStream = Readable.from(chunks.map(c => Buffer.from(c)))
			const result = yield encryptedStream({ stream: testStream }, 'document')
			expect(result).toBeDefined()
			expect(result.mediaKey).toBeDefined()
			expect(result.encFilePath).toBeDefined()
			expect(result.fileLength).toBe(chunks.join('').length)
			yield cleanupFiles([result.encFilePath, result.originalFilePath])
		}))
	it('should save original file when saveOriginalFileIfRequired is true', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const testData = Buffer.from('Original file content to save')
			const result = yield encryptedStream(testData, 'audio', {
				saveOriginalFileIfRequired: true
			})
			expect(result).toBeDefined()
			expect(result.originalFilePath).toBeDefined()
			const originalContent = yield fs.promises.readFile(result.originalFilePath)
			expect(originalContent.toString()).toBe(testData.toString())
			yield cleanupFiles([result.encFilePath, result.originalFilePath])
		}))
	it('should complete encryption for various media types', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker']
			const testData = Buffer.from('Test data for different media types')
			for (const mediaType of mediaTypes) {
				const result = yield encryptedStream(testData, mediaType)
				expect(result).toBeDefined()
				expect(result.mediaKey).toBeDefined()
				expect(result.encFilePath).toBeDefined()
				yield cleanupFiles([result.encFilePath, result.originalFilePath])
			}
		}))
	it('should handle empty buffer without hanging', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const emptyData = Buffer.from('')
			const result = yield encryptedStream(emptyData, 'image')
			expect(result).toBeDefined()
			expect(result.fileLength).toBe(0)
			expect(result.encFilePath).toBeDefined()
			yield cleanupFiles([result.encFilePath, result.originalFilePath])
		}))
	it('should handle small content that finishes quickly', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const smallData = Buffer.from('x')
			const result = yield encryptedStream(smallData, 'image')
			expect(result).toBeDefined()
			expect(result.fileLength).toBe(1)
			yield cleanupFiles([result.encFilePath, result.originalFilePath])
		}))
	it('should complete multiple concurrent encryptions without deadlock', () =>
		__awaiter(void 0, void 0, void 0, function* () {
			const testData = Buffer.from('Concurrent encryption test')
			const promises = Array.from({ length: 5 }, () => encryptedStream(testData, 'image'))
			const results = yield Promise.all(promises)
			expect(results.length).toBe(5)
			for (const result of results) {
				expect(result).toBeDefined()
				expect(result.mediaKey).toBeDefined()
				yield cleanupFiles([result.encFilePath, result.originalFilePath])
			}
		}))
})
