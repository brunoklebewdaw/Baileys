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
import { Mutex } from 'async-mutex'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { proto } from '../../WAProto/index.js'
import { initAuthCreds } from './auth-utils'
import { BufferJSON } from './generics'
// We need to lock files due to the fact that we are using async functions to read and write files
// https://github.com/WhiskeySockets/Baileys/issues/794
// https://github.com/nodejs/node/issues/26338
// Use a Map to store mutexes for each file path
const fileLocks = new Map()
// Get or create a mutex for a specific file path
const getFileLock = path => {
	let mutex = fileLocks.get(path)
	if (!mutex) {
		mutex = new Mutex()
		fileLocks.set(path, mutex)
	}
	return mutex
}
/**
 * stores the full authentication state in a single folder.
 * Far more efficient than singlefileauthstate
 *
 * Again, I wouldn't endorse this for any production level use other than perhaps a bot.
 * Would recommend writing an auth state for use with a proper SQL or No-SQL DB
 * */
export const useMultiFileAuthState = folder =>
	__awaiter(void 0, void 0, void 0, function* () {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writeData = (data, file) =>
			__awaiter(void 0, void 0, void 0, function* () {
				const filePath = join(folder, fixFileName(file))
				const mutex = getFileLock(filePath)
				return mutex.acquire().then(release =>
					__awaiter(void 0, void 0, void 0, function* () {
						try {
							yield writeFile(filePath, JSON.stringify(data, BufferJSON.replacer))
						} finally {
							release()
						}
					})
				)
			})
		const readData = file =>
			__awaiter(void 0, void 0, void 0, function* () {
				try {
					const filePath = join(folder, fixFileName(file))
					const mutex = getFileLock(filePath)
					return yield mutex.acquire().then(release =>
						__awaiter(void 0, void 0, void 0, function* () {
							try {
								const data = yield readFile(filePath, { encoding: 'utf-8' })
								return JSON.parse(data, BufferJSON.reviver)
							} finally {
								release()
							}
						})
					)
				} catch (error) {
					return null
				}
			})
		const removeData = file =>
			__awaiter(void 0, void 0, void 0, function* () {
				try {
					const filePath = join(folder, fixFileName(file))
					const mutex = getFileLock(filePath)
					return mutex.acquire().then(release =>
						__awaiter(void 0, void 0, void 0, function* () {
							try {
								yield unlink(filePath)
							} catch (_a) {
							} finally {
								release()
							}
						})
					)
				} catch (_a) {}
			})
		const folderInfo = yield stat(folder).catch(() => {})
		if (folderInfo) {
			if (!folderInfo.isDirectory()) {
				throw new Error(
					`found something that is not a directory at ${folder}, either delete it or specify a different location`
				)
			}
		} else {
			yield mkdir(folder, { recursive: true })
		}
		const fixFileName = file => {
			var _a
			return (_a = file === null || file === void 0 ? void 0 : file.replace(/\//g, '__')) === null || _a === void 0
				? void 0
				: _a.replace(/:/g, '-')
		}
		const creds = (yield readData('creds.json')) || initAuthCreds()
		return {
			state: {
				creds,
				keys: {
					get: (type, ids) =>
						__awaiter(void 0, void 0, void 0, function* () {
							const data = {}
							yield Promise.all(
								ids.map(id =>
									__awaiter(void 0, void 0, void 0, function* () {
										let value = yield readData(`${type}-${id}.json`)
										if (type === 'app-state-sync-key' && value) {
											value = proto.Message.AppStateSyncKeyData.fromObject(value)
										}
										data[id] = value
									})
								)
							)
							return data
						}),
					set: data =>
						__awaiter(void 0, void 0, void 0, function* () {
							const tasks = []
							for (const category in data) {
								for (const id in data[category]) {
									const value = data[category][id]
									const file = `${category}-${id}.json`
									tasks.push(value ? writeData(value, file) : removeData(file))
								}
							}
							yield Promise.all(tasks)
						})
				}
			},
			saveCreds: () =>
				__awaiter(void 0, void 0, void 0, function* () {
					return writeData(creds, 'creds.json')
				})
		}
	})
