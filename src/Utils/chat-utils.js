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
var __asyncValues =
	(this && this.__asyncValues) ||
	function (o) {
		if (!Symbol.asyncIterator) throw new TypeError('Symbol.asyncIterator is not defined.')
		var m = o[Symbol.asyncIterator],
			i
		return m
			? m.call(o)
			: ((o = typeof __values === 'function' ? __values(o) : o[Symbol.iterator]()),
				(i = {}),
				verb('next'),
				verb('throw'),
				verb('return'),
				(i[Symbol.asyncIterator] = function () {
					return this
				}),
				i)
		function verb(n) {
			i[n] =
				o[n] &&
				function (v) {
					return new Promise(function (resolve, reject) {
						;((v = o[n](v)), settle(resolve, reject, v.done, v.value))
					})
				}
		}
		function settle(resolve, reject, d, v) {
			Promise.resolve(v).then(function (v) {
				resolve({ value: v, done: d })
			}, reject)
		}
	}
import { Boom } from '@hapi/boom'
import { expandAppStateKeys } from 'whatsapp-rust-bridge'
import { proto } from '../../WAProto/index.js'
import { LabelAssociationType } from '../Types/LabelAssociation'
import { getBinaryNodeChild, getBinaryNodeChildren, isJidGroup, jidNormalizedUser } from '../WABinary'
import { aesDecrypt, aesEncrypt, hmacSign } from './crypto'
import { toNumber } from './generics'
import { LT_HASH_ANTI_TAMPERING } from './lt-hash'
import { downloadContentFromMessage } from './messages-media'
import { emitSyncActionResults, processContactAction } from './sync-action-utils'
const mutationKeys = keydata => {
	const keys = expandAppStateKeys(keydata)
	return {
		indexKey: keys.indexKey,
		valueEncryptionKey: keys.valueEncryptionKey,
		valueMacKey: keys.valueMacKey,
		snapshotMacKey: keys.snapshotMacKey,
		patchMacKey: keys.patchMacKey
	}
}
const generateMac = (operation, data, keyId, key) => {
	const opByte = operation === proto.SyncdMutation.SyncdOperation.SET ? 0x01 : 0x02
	const keyIdBuffer = typeof keyId === 'string' ? Buffer.from(keyId, 'base64') : keyId
	const keyData = new Uint8Array(1 + keyIdBuffer.length)
	keyData[0] = opByte
	keyData.set(keyIdBuffer, 1)
	const last = new Uint8Array(8)
	last[7] = keyData.length
	const total = new Uint8Array(keyData.length + data.length + last.length)
	total.set(keyData, 0)
	total.set(data, keyData.length)
	total.set(last, keyData.length + data.length)
	const hmac = hmacSign(total, key, 'sha512')
	return hmac.subarray(0, 32)
}
const to64BitNetworkOrder = e => {
	const buff = Buffer.alloc(8)
	buff.writeUint32BE(e, 4)
	return buff
}
export const makeLtHashGenerator = ({ indexValueMap, hash }) => {
	indexValueMap = Object.assign({}, indexValueMap)
	const addBuffs = []
	const subBuffs = []
	return {
		mix: ({ indexMac, valueMac, operation }) => {
			const indexMacBase64 = Buffer.from(indexMac).toString('base64')
			const prevOp = indexValueMap[indexMacBase64]
			if (operation === proto.SyncdMutation.SyncdOperation.REMOVE) {
				if (!prevOp) {
					// WA Web does not throw here — it logs a warning and skips the subtract.
					// The missing REMOVE will cause an LTHash mismatch, which is handled
					// by the MAC validation layer (snapshot recovery or retry).
					return
				}
				// remove from index value mac, since this mutation is erased
				delete indexValueMap[indexMacBase64]
			} else {
				addBuffs.push(valueMac)
				// add this index into the history map
				indexValueMap[indexMacBase64] = { valueMac }
			}
			if (prevOp) {
				subBuffs.push(prevOp.valueMac)
			}
		},
		finish: () => {
			const result = LT_HASH_ANTI_TAMPERING.subtractThenAdd(hash, subBuffs, addBuffs)
			return {
				hash: Buffer.from(result),
				indexValueMap
			}
		}
	}
}
const generateSnapshotMac = (lthash, version, name, key) => {
	const total = Buffer.concat([lthash, to64BitNetworkOrder(version), Buffer.from(name, 'utf-8')])
	return hmacSign(total, key, 'sha256')
}
const generatePatchMac = (snapshotMac, valueMacs, version, type, key) => {
	const total = Buffer.concat([snapshotMac, ...valueMacs, to64BitNetworkOrder(version), Buffer.from(type, 'utf-8')])
	return hmacSign(total, key)
}
export const newLTHashState = () => ({ version: 0, hash: Buffer.alloc(128), indexValueMap: {} })
export const ensureLTHashStateVersion = state => {
	if (typeof state.version !== 'number' || isNaN(state.version)) {
		state.version = 0
	}
	return state
}
export const MAX_SYNC_ATTEMPTS = 2
/**
 * Check if an error is a missing app state sync key.
 * WA Web treats these as "Blocked" (waits for key arrival), not fatal.
 * In Baileys we retry with a snapshot which may use a different key.
 */
export const isMissingKeyError = error => {
	var _a
	return (
		((_a = error === null || error === void 0 ? void 0 : error.data) === null || _a === void 0
			? void 0
			: _a.isMissingKey) === true
	)
}
/**
 * Determines if an app state sync error is unrecoverable.
 * TypeError indicates a WASM crash; otherwise we give up after MAX_SYNC_ATTEMPTS.
 * Missing keys are NOT checked here — they are handled separately as "Blocked".
 */
export const isAppStateSyncIrrecoverable = (error, attempts) => {
	return attempts >= MAX_SYNC_ATTEMPTS || (error === null || error === void 0 ? void 0 : error.name) === 'TypeError'
}
export const encodeSyncdPatch = (_a, myAppStateKeyId_1, state_1, getAppStateSyncKey_1) =>
	__awaiter(
		void 0,
		[_a, myAppStateKeyId_1, state_1, getAppStateSyncKey_1],
		void 0,
		function* ({ type, index, syncAction, apiVersion, operation }, myAppStateKeyId, state, getAppStateSyncKey) {
			const key = !!myAppStateKeyId ? yield getAppStateSyncKey(myAppStateKeyId) : undefined
			if (!key) {
				throw new Boom(`myAppStateKey ("${myAppStateKeyId}") not present`, { data: { isMissingKey: true } })
			}
			const encKeyId = Buffer.from(myAppStateKeyId, 'base64')
			state = Object.assign(Object.assign({}, state), { indexValueMap: Object.assign({}, state.indexValueMap) })
			const indexBuffer = Buffer.from(JSON.stringify(index))
			const dataProto = proto.SyncActionData.fromObject({
				index: indexBuffer,
				value: syncAction,
				padding: new Uint8Array(0),
				version: apiVersion
			})
			const encoded = proto.SyncActionData.encode(dataProto).finish()
			const keyValue = mutationKeys(key.keyData)
			const encValue = aesEncrypt(encoded, keyValue.valueEncryptionKey)
			const valueMac = generateMac(operation, encValue, encKeyId, keyValue.valueMacKey)
			const indexMac = hmacSign(indexBuffer, keyValue.indexKey)
			// update LT hash
			const generator = makeLtHashGenerator(state)
			generator.mix({ indexMac, valueMac, operation })
			Object.assign(state, generator.finish())
			state.version += 1
			const snapshotMac = generateSnapshotMac(state.hash, state.version, type, keyValue.snapshotMacKey)
			const patch = {
				patchMac: generatePatchMac(snapshotMac, [valueMac], state.version, type, keyValue.patchMacKey),
				snapshotMac: snapshotMac,
				keyId: { id: encKeyId },
				mutations: [
					{
						operation: operation,
						record: {
							index: {
								blob: indexMac
							},
							value: {
								blob: Buffer.concat([encValue, valueMac])
							},
							keyId: { id: encKeyId }
						}
					}
				]
			}
			const base64Index = indexMac.toString('base64')
			state.indexValueMap[base64Index] = { valueMac }
			return { patch, state }
		}
	)
export const decodeSyncdMutations = (msgMutations, initialState, getAppStateSyncKey, onMutation, validateMacs) =>
	__awaiter(void 0, void 0, void 0, function* () {
		const ltGenerator = makeLtHashGenerator(initialState)
		const derivedKeyCache = new Map()
		// indexKey used to HMAC sign record.index.blob
		// valueEncryptionKey used to AES-256-CBC encrypt record.value.blob[0:-32]
		// the remaining record.value.blob[0:-32] is the mac, it the HMAC sign of key.keyId + decoded proto data + length of bytes in keyId
		for (const msgMutation of msgMutations) {
			// if it's a syncdmutation, get the operation property
			// otherwise, if it's only a record -- it'll be a SET mutation
			const operation = 'operation' in msgMutation ? msgMutation.operation : proto.SyncdMutation.SyncdOperation.SET
			const record = 'record' in msgMutation && !!msgMutation.record ? msgMutation.record : msgMutation
			const key = yield getKey(record.keyId.id)
			const content = record.value.blob
			const encContent = content.subarray(0, -32)
			const ogValueMac = content.subarray(-32)
			if (validateMacs) {
				const contentHmac = generateMac(operation, encContent, record.keyId.id, key.valueMacKey)
				if (Buffer.compare(contentHmac, ogValueMac) !== 0) {
					throw new Boom('HMAC content verification failed')
				}
			}
			const result = aesDecrypt(encContent, key.valueEncryptionKey)
			const syncAction = proto.SyncActionData.decode(result)
			if (validateMacs) {
				const hmac = hmacSign(syncAction.index, key.indexKey)
				if (Buffer.compare(hmac, record.index.blob) !== 0) {
					throw new Boom('HMAC index verification failed')
				}
			}
			const indexStr = Buffer.from(syncAction.index).toString()
			onMutation({ syncAction, index: JSON.parse(indexStr) })
			ltGenerator.mix({
				indexMac: record.index.blob,
				valueMac: ogValueMac,
				operation: operation
			})
		}
		return ltGenerator.finish()
		function getKey(keyId) {
			return __awaiter(this, void 0, void 0, function* () {
				const base64Key = Buffer.from(keyId).toString('base64')
				const cached = derivedKeyCache.get(base64Key)
				if (cached) {
					return cached
				}
				const keyEnc = yield getAppStateSyncKey(base64Key)
				if (!keyEnc) {
					throw new Boom(`failed to find key "${base64Key}" to decode mutation`, {
						data: { isMissingKey: true, msgMutations }
					})
				}
				const keys = mutationKeys(keyEnc.keyData)
				derivedKeyCache.set(base64Key, keys)
				return keys
			})
		}
	})
export const decodeSyncdPatch = (msg, name, initialState, getAppStateSyncKey, onMutation, validateMacs) =>
	__awaiter(void 0, void 0, void 0, function* () {
		if (validateMacs) {
			const base64Key = Buffer.from(msg.keyId.id).toString('base64')
			const mainKeyObj = yield getAppStateSyncKey(base64Key)
			if (!mainKeyObj) {
				throw new Boom(`failed to find key "${base64Key}" to decode patch`, { data: { isMissingKey: true, msg } })
			}
			const mainKey = mutationKeys(mainKeyObj.keyData)
			const mutationmacs = msg.mutations.map(mutation => mutation.record.value.blob.slice(-32))
			const patchMac = generatePatchMac(
				msg.snapshotMac,
				mutationmacs,
				toNumber(msg.version.version),
				name,
				mainKey.patchMacKey
			)
			if (Buffer.compare(patchMac, msg.patchMac) !== 0) {
				throw new Boom('Invalid patch mac')
			}
		}
		const result = yield decodeSyncdMutations(msg.mutations, initialState, getAppStateSyncKey, onMutation, validateMacs)
		return result
	})
export const extractSyncdPatches = (result, options) =>
	__awaiter(void 0, void 0, void 0, function* () {
		const syncNode = getBinaryNodeChild(result, 'sync')
		const collectionNodes = getBinaryNodeChildren(syncNode, 'collection')
		const final = {}
		yield Promise.all(
			collectionNodes.map(collectionNode =>
				__awaiter(void 0, void 0, void 0, function* () {
					const patchesNode = getBinaryNodeChild(collectionNode, 'patches')
					const patches = getBinaryNodeChildren(patchesNode || collectionNode, 'patch')
					const snapshotNode = getBinaryNodeChild(collectionNode, 'snapshot')
					const syncds = []
					const name = collectionNode.attrs.name
					const hasMorePatches = collectionNode.attrs.has_more_patches === 'true'
					let snapshot = undefined
					if (snapshotNode && !!snapshotNode.content) {
						if (!Buffer.isBuffer(snapshotNode)) {
							snapshotNode.content = Buffer.from(Object.values(snapshotNode.content))
						}
						const blobRef = proto.ExternalBlobReference.decode(snapshotNode.content)
						const data = yield downloadExternalBlob(blobRef, options)
						snapshot = proto.SyncdSnapshot.decode(data)
					}
					for (let { content } of patches) {
						if (content) {
							if (!Buffer.isBuffer(content)) {
								content = Buffer.from(Object.values(content))
							}
							const syncd = proto.SyncdPatch.decode(content)
							if (!syncd.version) {
								syncd.version = { version: +collectionNode.attrs.version + 1 }
							}
							syncds.push(syncd)
						}
					}
					final[name] = { patches: syncds, hasMorePatches, snapshot }
				})
			)
		)
		return final
	})
export const downloadExternalBlob = (blob, options) =>
	__awaiter(void 0, void 0, void 0, function* () {
		var _a, e_1, _b, _c
		const stream = yield downloadContentFromMessage(blob, 'md-app-state', { options })
		const bufferArray = []
		try {
			for (
				var _d = true, stream_1 = __asyncValues(stream), stream_1_1;
				(stream_1_1 = yield stream_1.next()), (_a = stream_1_1.done), !_a;
				_d = true
			) {
				_c = stream_1_1.value
				_d = false
				const chunk = _c
				bufferArray.push(chunk)
			}
		} catch (e_1_1) {
			e_1 = { error: e_1_1 }
		} finally {
			try {
				if (!_d && !_a && (_b = stream_1.return)) yield _b.call(stream_1)
			} finally {
				if (e_1) throw e_1.error
			}
		}
		return Buffer.concat(bufferArray)
	})
export const downloadExternalPatch = (blob, options) =>
	__awaiter(void 0, void 0, void 0, function* () {
		const buffer = yield downloadExternalBlob(blob, options)
		const syncData = proto.SyncdMutations.decode(buffer)
		return syncData
	})
export const decodeSyncdSnapshot = (name_1, snapshot_1, getAppStateSyncKey_1, minimumVersionNumber_1, ...args_1) =>
	__awaiter(
		void 0,
		[name_1, snapshot_1, getAppStateSyncKey_1, minimumVersionNumber_1, ...args_1],
		void 0,
		function* (name, snapshot, getAppStateSyncKey, minimumVersionNumber, validateMacs = true) {
			const newState = newLTHashState()
			newState.version = toNumber(snapshot.version.version)
			const mutationMap = {}
			const areMutationsRequired =
				typeof minimumVersionNumber === 'undefined' || newState.version > minimumVersionNumber
			const { hash, indexValueMap } = yield decodeSyncdMutations(
				snapshot.records,
				newState,
				getAppStateSyncKey,
				areMutationsRequired
					? mutation => {
							var _a
							const index = (_a = mutation.syncAction.index) === null || _a === void 0 ? void 0 : _a.toString()
							mutationMap[index] = mutation
						}
					: () => {},
				validateMacs
			)
			newState.hash = hash
			newState.indexValueMap = indexValueMap
			if (validateMacs) {
				const base64Key = Buffer.from(snapshot.keyId.id).toString('base64')
				const keyEnc = yield getAppStateSyncKey(base64Key)
				if (!keyEnc) {
					throw new Boom(`failed to find key "${base64Key}" to decode mutation`, { data: { isMissingKey: true } })
				}
				const result = mutationKeys(keyEnc.keyData)
				const computedSnapshotMac = generateSnapshotMac(newState.hash, newState.version, name, result.snapshotMacKey)
				if (Buffer.compare(snapshot.mac, computedSnapshotMac) !== 0) {
					throw new Boom(`failed to verify LTHash at ${newState.version} of ${name} from snapshot`)
				}
			}
			return {
				state: newState,
				mutationMap
			}
		}
	)
export const decodePatches = (
	name_1,
	syncds_1,
	initial_1,
	getAppStateSyncKey_1,
	options_1,
	minimumVersionNumber_1,
	logger_1,
	...args_1
) =>
	__awaiter(
		void 0,
		[name_1, syncds_1, initial_1, getAppStateSyncKey_1, options_1, minimumVersionNumber_1, logger_1, ...args_1],
		void 0,
		function* (name, syncds, initial, getAppStateSyncKey, options, minimumVersionNumber, logger, validateMacs = true) {
			var _a
			const newState = Object.assign(Object.assign({}, initial), {
				indexValueMap: Object.assign({}, initial.indexValueMap)
			})
			const mutationMap = {}
			for (const syncd of syncds) {
				const { version, keyId, snapshotMac } = syncd
				if (syncd.externalMutations) {
					logger === null || logger === void 0 ? void 0 : logger.trace({ name, version }, 'downloading external patch')
					const ref = yield downloadExternalPatch(syncd.externalMutations, options)
					logger === null || logger === void 0
						? void 0
						: logger.debug({ name, version, mutations: ref.mutations.length }, 'downloaded external patch')
					;(_a = syncd.mutations) === null || _a === void 0 ? void 0 : _a.push(...ref.mutations)
				}
				const patchVersion = toNumber(version.version)
				newState.version = patchVersion
				const shouldMutate = typeof minimumVersionNumber === 'undefined' || patchVersion > minimumVersionNumber
				const decodeResult = yield decodeSyncdPatch(
					syncd,
					name,
					newState,
					getAppStateSyncKey,
					shouldMutate
						? mutation => {
								var _a
								const index = (_a = mutation.syncAction.index) === null || _a === void 0 ? void 0 : _a.toString()
								mutationMap[index] = mutation
							}
						: () => {},
					true
				)
				newState.hash = decodeResult.hash
				newState.indexValueMap = decodeResult.indexValueMap
				if (validateMacs) {
					const base64Key = Buffer.from(keyId.id).toString('base64')
					const keyEnc = yield getAppStateSyncKey(base64Key)
					if (!keyEnc) {
						throw new Boom(`failed to find key "${base64Key}" to decode mutation`, { data: { isMissingKey: true } })
					}
					const result = mutationKeys(keyEnc.keyData)
					const computedSnapshotMac = generateSnapshotMac(newState.hash, newState.version, name, result.snapshotMacKey)
					if (Buffer.compare(snapshotMac, computedSnapshotMac) !== 0) {
						throw new Boom(`failed to verify LTHash at ${newState.version} of ${name}`)
					}
				}
				// clear memory used up by the mutations
				syncd.mutations = []
			}
			return { state: newState, mutationMap }
		}
	)
export const chatModificationToAppPatch = (mod, jid) => {
	const OP = proto.SyncdMutation.SyncdOperation
	const getMessageRange = lastMessages => {
		let messageRange
		if (Array.isArray(lastMessages)) {
			const lastMsg = lastMessages[lastMessages.length - 1]
			messageRange = {
				lastMessageTimestamp: lastMsg === null || lastMsg === void 0 ? void 0 : lastMsg.messageTimestamp,
				messages: (lastMessages === null || lastMessages === void 0 ? void 0 : lastMessages.length)
					? lastMessages.map(m => {
							var _a, _b
							if (
								!((_a = m.key) === null || _a === void 0 ? void 0 : _a.id) ||
								!((_b = m.key) === null || _b === void 0 ? void 0 : _b.remoteJid)
							) {
								throw new Boom('Incomplete key', { statusCode: 400, data: m })
							}
							if (isJidGroup(m.key.remoteJid) && !m.key.fromMe && !m.key.participant) {
								throw new Boom('Expected not from me message to have participant', { statusCode: 400, data: m })
							}
							if (!m.messageTimestamp || !toNumber(m.messageTimestamp)) {
								throw new Boom('Missing timestamp in last message list', { statusCode: 400, data: m })
							}
							if (m.key.participant) {
								m.key.participant = jidNormalizedUser(m.key.participant)
							}
							return m
						})
					: undefined
			}
		} else {
			messageRange = lastMessages
		}
		return messageRange
	}
	let patch
	if ('mute' in mod) {
		patch = {
			syncAction: {
				muteAction: {
					muted: !!mod.mute,
					muteEndTimestamp: mod.mute || undefined
				}
			},
			index: ['mute', jid],
			type: 'regular_high',
			apiVersion: 2,
			operation: OP.SET
		}
	} else if ('archive' in mod) {
		patch = {
			syncAction: {
				archiveChatAction: {
					archived: !!mod.archive,
					messageRange: getMessageRange(mod.lastMessages)
				}
			},
			index: ['archive', jid],
			type: 'regular_low',
			apiVersion: 3,
			operation: OP.SET
		}
	} else if ('markRead' in mod) {
		patch = {
			syncAction: {
				markChatAsReadAction: {
					read: mod.markRead,
					messageRange: getMessageRange(mod.lastMessages)
				}
			},
			index: ['markChatAsRead', jid],
			type: 'regular_low',
			apiVersion: 3,
			operation: OP.SET
		}
	} else if ('deleteForMe' in mod) {
		const { timestamp, key, deleteMedia } = mod.deleteForMe
		patch = {
			syncAction: {
				deleteMessageForMeAction: {
					deleteMedia,
					messageTimestamp: timestamp
				}
			},
			index: ['deleteMessageForMe', jid, key.id, key.fromMe ? '1' : '0', '0'],
			type: 'regular_high',
			apiVersion: 3,
			operation: OP.SET
		}
	} else if ('clear' in mod) {
		patch = {
			syncAction: {
				clearChatAction: {
					messageRange: getMessageRange(mod.lastMessages)
				}
			},
			index: ['clearChat', jid, '1' /*the option here is 0 when keep starred messages is enabled*/, '0'],
			type: 'regular_high',
			apiVersion: 6,
			operation: OP.SET
		}
	} else if ('pin' in mod) {
		patch = {
			syncAction: {
				pinAction: {
					pinned: !!mod.pin
				}
			},
			index: ['pin_v1', jid],
			type: 'regular_low',
			apiVersion: 5,
			operation: OP.SET
		}
	} else if ('contact' in mod) {
		patch = {
			syncAction: {
				contactAction: mod.contact || {}
			},
			index: ['contact', jid],
			type: 'critical_unblock_low',
			apiVersion: 2,
			operation: mod.contact ? OP.SET : OP.REMOVE
		}
	} else if ('disableLinkPreviews' in mod) {
		patch = {
			syncAction: {
				privacySettingDisableLinkPreviewsAction: mod.disableLinkPreviews || {}
			},
			index: ['setting_disableLinkPreviews'],
			type: 'regular',
			apiVersion: 8,
			operation: OP.SET
		}
	} else if ('star' in mod) {
		const key = mod.star.messages[0]
		patch = {
			syncAction: {
				starAction: {
					starred: !!mod.star.star
				}
			},
			index: ['star', jid, key.id, key.fromMe ? '1' : '0', '0'],
			type: 'regular_low',
			apiVersion: 2,
			operation: OP.SET
		}
	} else if ('delete' in mod) {
		patch = {
			syncAction: {
				deleteChatAction: {
					messageRange: getMessageRange(mod.lastMessages)
				}
			},
			index: ['deleteChat', jid, '1'],
			type: 'regular_high',
			apiVersion: 6,
			operation: OP.SET
		}
	} else if ('pushNameSetting' in mod) {
		patch = {
			syncAction: {
				pushNameSetting: {
					name: mod.pushNameSetting
				}
			},
			index: ['setting_pushName'],
			type: 'critical_block',
			apiVersion: 1,
			operation: OP.SET
		}
	} else if ('quickReply' in mod) {
		patch = {
			syncAction: {
				quickReplyAction: {
					count: 0,
					deleted: mod.quickReply.deleted || false,
					keywords: [],
					message: mod.quickReply.message || '',
					shortcut: mod.quickReply.shortcut || ''
				}
			},
			index: ['quick_reply', mod.quickReply.timestamp || String(Math.floor(Date.now() / 1000))],
			type: 'regular',
			apiVersion: 2,
			operation: OP.SET
		}
	} else if ('addLabel' in mod) {
		patch = {
			syncAction: {
				labelEditAction: {
					name: mod.addLabel.name,
					color: mod.addLabel.color,
					predefinedId: mod.addLabel.predefinedId,
					deleted: mod.addLabel.deleted
				}
			},
			index: ['label_edit', mod.addLabel.id],
			type: 'regular',
			apiVersion: 3,
			operation: OP.SET
		}
	} else if ('addChatLabel' in mod) {
		patch = {
			syncAction: {
				labelAssociationAction: {
					labeled: true
				}
			},
			index: [LabelAssociationType.Chat, mod.addChatLabel.labelId, jid],
			type: 'regular',
			apiVersion: 3,
			operation: OP.SET
		}
	} else if ('removeChatLabel' in mod) {
		patch = {
			syncAction: {
				labelAssociationAction: {
					labeled: false
				}
			},
			index: [LabelAssociationType.Chat, mod.removeChatLabel.labelId, jid],
			type: 'regular',
			apiVersion: 3,
			operation: OP.SET
		}
	} else if ('addMessageLabel' in mod) {
		patch = {
			syncAction: {
				labelAssociationAction: {
					labeled: true
				}
			},
			index: [LabelAssociationType.Message, mod.addMessageLabel.labelId, jid, mod.addMessageLabel.messageId, '0', '0'],
			type: 'regular',
			apiVersion: 3,
			operation: OP.SET
		}
	} else if ('removeMessageLabel' in mod) {
		patch = {
			syncAction: {
				labelAssociationAction: {
					labeled: false
				}
			},
			index: [
				LabelAssociationType.Message,
				mod.removeMessageLabel.labelId,
				jid,
				mod.removeMessageLabel.messageId,
				'0',
				'0'
			],
			type: 'regular',
			apiVersion: 3,
			operation: OP.SET
		}
	} else {
		throw new Boom('not supported')
	}
	patch.syncAction.timestamp = Date.now()
	return patch
}
export const processSyncAction = (syncAction, ev, me, initialSyncOpts, logger) => {
	var _a, _b, _c, _d, _e, _f
	const isInitialSync = !!initialSyncOpts
	const accountSettings =
		initialSyncOpts === null || initialSyncOpts === void 0 ? void 0 : initialSyncOpts.accountSettings
	logger === null || logger === void 0
		? void 0
		: logger.trace({ syncAction, initialSync: !!initialSyncOpts }, 'processing sync action')
	const {
		syncAction: { value: action },
		index: [type, id, msgId, fromMe]
	} = syncAction
	if (action === null || action === void 0 ? void 0 : action.muteAction) {
		ev.emit('chats.update', [
			{
				id,
				muteEndTime: ((_a = action.muteAction) === null || _a === void 0 ? void 0 : _a.muted)
					? toNumber(action.muteAction.muteEndTimestamp)
					: null,
				conditional: getChatUpdateConditional(id, undefined)
			}
		])
	} else if (
		(action === null || action === void 0 ? void 0 : action.archiveChatAction) ||
		type === 'archive' ||
		type === 'unarchive'
	) {
		// okay so we've to do some annoying computation here
		// when we're initially syncing the app state
		// there are a few cases we need to handle
		// 1. if the account unarchiveChats setting is true
		//   a. if the chat is archived, and no further messages have been received -- simple, keep archived
		//   b. if the chat was archived, and the user received messages from the other person afterwards
		//		then the chat should be marked unarchved --
		//		we compare the timestamp of latest message from the other person to determine this
		// 2. if the account unarchiveChats setting is false -- then it doesn't matter,
		//	it'll always take an app state action to mark in unarchived -- which we'll get anyway
		const archiveAction = action === null || action === void 0 ? void 0 : action.archiveChatAction
		const isArchived = archiveAction ? archiveAction.archived : type === 'archive'
		// // basically we don't need to fire an "archive" update if the chat is being marked unarchvied
		// // this only applies for the initial sync
		// if(isInitialSync && !isArchived) {
		// 	isArchived = false
		// }
		const msgRange = !(accountSettings === null || accountSettings === void 0 ? void 0 : accountSettings.unarchiveChats)
			? undefined
			: archiveAction === null || archiveAction === void 0
				? void 0
				: archiveAction.messageRange
		// logger?.debug({ chat: id, syncAction }, 'message range archive')
		ev.emit('chats.update', [
			{
				id,
				archived: isArchived,
				conditional: getChatUpdateConditional(id, msgRange)
			}
		])
	} else if (action === null || action === void 0 ? void 0 : action.markChatAsReadAction) {
		const markReadAction = action.markChatAsReadAction
		// basically we don't need to fire an "read" update if the chat is being marked as read
		// because the chat is read by default
		// this only applies for the initial sync
		const isNullUpdate = isInitialSync && markReadAction.read
		ev.emit('chats.update', [
			{
				id,
				unreadCount: isNullUpdate
					? null
					: !!(markReadAction === null || markReadAction === void 0 ? void 0 : markReadAction.read)
						? 0
						: -1,
				conditional: getChatUpdateConditional(
					id,
					markReadAction === null || markReadAction === void 0 ? void 0 : markReadAction.messageRange
				)
			}
		])
	} else if (
		(action === null || action === void 0 ? void 0 : action.deleteMessageForMeAction) ||
		type === 'deleteMessageForMe'
	) {
		ev.emit('messages.delete', {
			keys: [
				{
					remoteJid: id,
					id: msgId,
					fromMe: fromMe === '1'
				}
			]
		})
	} else if (action === null || action === void 0 ? void 0 : action.contactAction) {
		const results = processContactAction(action.contactAction, id, logger)
		emitSyncActionResults(ev, results)
	} else if (action === null || action === void 0 ? void 0 : action.pushNameSetting) {
		const name =
			(_b = action === null || action === void 0 ? void 0 : action.pushNameSetting) === null || _b === void 0
				? void 0
				: _b.name
		if (name && (me === null || me === void 0 ? void 0 : me.name) !== name) {
			ev.emit('creds.update', { me: Object.assign(Object.assign({}, me), { name }) })
		}
	} else if (action === null || action === void 0 ? void 0 : action.pinAction) {
		ev.emit('chats.update', [
			{
				id,
				pinned: ((_c = action.pinAction) === null || _c === void 0 ? void 0 : _c.pinned)
					? toNumber(action.timestamp)
					: null,
				conditional: getChatUpdateConditional(id, undefined)
			}
		])
	} else if (action === null || action === void 0 ? void 0 : action.unarchiveChatsSetting) {
		const unarchiveChats = !!action.unarchiveChatsSetting.unarchiveChats
		ev.emit('creds.update', { accountSettings: { unarchiveChats } })
		logger === null || logger === void 0
			? void 0
			: logger.info(`archive setting updated => '${action.unarchiveChatsSetting.unarchiveChats}'`)
		if (accountSettings) {
			accountSettings.unarchiveChats = unarchiveChats
		}
	} else if ((action === null || action === void 0 ? void 0 : action.starAction) || type === 'star') {
		let starred =
			(_d = action === null || action === void 0 ? void 0 : action.starAction) === null || _d === void 0
				? void 0
				: _d.starred
		if (typeof starred !== 'boolean') {
			starred = syncAction.index[syncAction.index.length - 1] === '1'
		}
		ev.emit('messages.update', [
			{
				key: { remoteJid: id, id: msgId, fromMe: fromMe === '1' },
				update: { starred }
			}
		])
	} else if ((action === null || action === void 0 ? void 0 : action.deleteChatAction) || type === 'deleteChat') {
		if (!isInitialSync) {
			ev.emit('chats.delete', [id])
		}
	} else if (action === null || action === void 0 ? void 0 : action.labelEditAction) {
		const { name, color, deleted, predefinedId } = action.labelEditAction
		ev.emit('labels.edit', {
			id: id,
			name: name,
			color: color,
			deleted: deleted,
			predefinedId: predefinedId ? String(predefinedId) : undefined
		})
	} else if (action === null || action === void 0 ? void 0 : action.labelAssociationAction) {
		ev.emit('labels.association', {
			type: action.labelAssociationAction.labeled ? 'add' : 'remove',
			association:
				type === LabelAssociationType.Chat
					? {
							type: LabelAssociationType.Chat,
							chatId: syncAction.index[2],
							labelId: syncAction.index[1]
						}
					: {
							type: LabelAssociationType.Message,
							chatId: syncAction.index[2],
							messageId: syncAction.index[3],
							labelId: syncAction.index[1]
						}
		})
	} else if (
		(_e = action === null || action === void 0 ? void 0 : action.localeSetting) === null || _e === void 0
			? void 0
			: _e.locale
	) {
		ev.emit('settings.update', { setting: 'locale', value: action.localeSetting.locale })
	} else if (action === null || action === void 0 ? void 0 : action.timeFormatAction) {
		ev.emit('settings.update', { setting: 'timeFormat', value: action.timeFormatAction })
	} else if (action === null || action === void 0 ? void 0 : action.pnForLidChatAction) {
		if (action.pnForLidChatAction.pnJid) {
			ev.emit('lid-mapping.update', { lid: id, pn: action.pnForLidChatAction.pnJid })
		}
	} else if (action === null || action === void 0 ? void 0 : action.privacySettingRelayAllCalls) {
		ev.emit('settings.update', {
			setting: 'privacySettingRelayAllCalls',
			value: action.privacySettingRelayAllCalls
		})
	} else if (action === null || action === void 0 ? void 0 : action.statusPrivacy) {
		ev.emit('settings.update', { setting: 'statusPrivacy', value: action.statusPrivacy })
	} else if (action === null || action === void 0 ? void 0 : action.lockChatAction) {
		ev.emit('chats.lock', { id: id, locked: !!action.lockChatAction.locked })
	} else if (action === null || action === void 0 ? void 0 : action.privacySettingDisableLinkPreviewsAction) {
		ev.emit('settings.update', {
			setting: 'disableLinkPreviews',
			value: action.privacySettingDisableLinkPreviewsAction
		})
	} else if (
		(_f = action === null || action === void 0 ? void 0 : action.notificationActivitySettingAction) === null ||
		_f === void 0
			? void 0
			: _f.notificationActivitySetting
	) {
		ev.emit('settings.update', {
			setting: 'notificationActivitySetting',
			value: action.notificationActivitySettingAction.notificationActivitySetting
		})
	} else if (action === null || action === void 0 ? void 0 : action.lidContactAction) {
		ev.emit('contacts.upsert', [
			{
				id: id,
				name:
					action.lidContactAction.fullName ||
					action.lidContactAction.firstName ||
					action.lidContactAction.username ||
					undefined,
				username: action.lidContactAction.username || undefined,
				lid: id,
				phoneNumber: undefined
			}
		])
	} else if (
		action === null || action === void 0 ? void 0 : action.privacySettingChannelsPersonalisedRecommendationAction
	) {
		ev.emit('settings.update', {
			setting: 'channelsPersonalisedRecommendation',
			value: action.privacySettingChannelsPersonalisedRecommendationAction
		})
	} else {
		logger === null || logger === void 0 ? void 0 : logger.debug({ syncAction, id }, 'unprocessable update')
	}
	function getChatUpdateConditional(id, msgRange) {
		return isInitialSync
			? data => {
					const chat = data.historySets.chats[id] || data.chatUpserts[id]
					if (chat) {
						return msgRange ? isValidPatchBasedOnMessageRange(chat, msgRange) : true
					}
				}
			: undefined
	}
	function isValidPatchBasedOnMessageRange(chat, msgRange) {
		const lastMsgTimestamp = Number(
			(msgRange === null || msgRange === void 0 ? void 0 : msgRange.lastMessageTimestamp) ||
				(msgRange === null || msgRange === void 0 ? void 0 : msgRange.lastSystemMessageTimestamp) ||
				0
		)
		const chatLastMsgTimestamp = Number(
			(chat === null || chat === void 0 ? void 0 : chat.lastMessageRecvTimestamp) || 0
		)
		return lastMsgTimestamp >= chatLastMsgTimestamp
	}
}
