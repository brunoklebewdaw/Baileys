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
import { LRUCache } from 'lru-cache'
import { isHostedPnUser, isLidUser, isPnUser, jidDecode, jidNormalizedUser, WAJIDDomains } from '../WABinary'
export class LIDMappingStore {
	constructor(keys, logger, pnToLIDFunc) {
		this.mappingCache = new LRUCache({
			ttl: 3 * 24 * 60 * 60 * 1000, // 7 days
			ttlAutopurge: true,
			updateAgeOnGet: true
		})
		this.inflightLIDLookups = new Map()
		this.inflightPNLookups = new Map()
		this.keys = keys
		this.pnToLIDFunc = pnToLIDFunc
		this.logger = logger
	}
	storeLIDPNMappings(pairs) {
		return __awaiter(this, void 0, void 0, function* () {
			if (pairs.length === 0) return
			const validatedPairs = []
			for (const { lid, pn } of pairs) {
				if (!((isLidUser(lid) && isPnUser(pn)) || (isPnUser(lid) && isLidUser(pn)))) {
					this.logger.warn(`Invalid LID-PN mapping: ${lid}, ${pn}`)
					continue
				}
				const lidDecoded = jidDecode(lid)
				const pnDecoded = jidDecode(pn)
				if (!lidDecoded || !pnDecoded) continue
				validatedPairs.push({ pnUser: pnDecoded.user, lidUser: lidDecoded.user })
			}
			if (validatedPairs.length === 0) return
			const cacheMissSet = new Set()
			const existingMappings = new Map()
			for (const { pnUser } of validatedPairs) {
				const cached = this.mappingCache.get(`pn:${pnUser}`)
				if (cached) {
					existingMappings.set(pnUser, cached)
				} else {
					cacheMissSet.add(pnUser)
				}
			}
			if (cacheMissSet.size > 0) {
				const cacheMisses = [...cacheMissSet]
				this.logger.trace(`Batch fetching ${cacheMisses.length} LID mappings from database`)
				const stored = yield this.keys.get('lid-mapping', cacheMisses)
				for (const pnUser of cacheMisses) {
					const existingLidUser = stored[pnUser]
					if (existingLidUser) {
						existingMappings.set(pnUser, existingLidUser)
						this.mappingCache.set(`pn:${pnUser}`, existingLidUser)
						this.mappingCache.set(`lid:${existingLidUser}`, pnUser)
					}
				}
			}
			const pairMap = {}
			for (const { pnUser, lidUser } of validatedPairs) {
				const existingLidUser = existingMappings.get(pnUser)
				if (existingLidUser === lidUser) {
					this.logger.debug({ pnUser, lidUser }, 'LID mapping already exists, skipping')
					continue
				}
				pairMap[pnUser] = lidUser
			}
			if (Object.keys(pairMap).length === 0) return
			this.logger.trace({ pairMap }, `Storing ${Object.keys(pairMap).length} pn mappings`)
			const batchData = {}
			for (const [pnUser, lidUser] of Object.entries(pairMap)) {
				batchData[pnUser] = lidUser
				batchData[`${lidUser}_reverse`] = pnUser
			}
			yield this.keys.transaction(
				() =>
					__awaiter(this, void 0, void 0, function* () {
						yield this.keys.set({ 'lid-mapping': batchData })
					}),
				'lid-mapping'
			)
			// Update cache after successful DB write
			for (const [pnUser, lidUser] of Object.entries(pairMap)) {
				this.mappingCache.set(`pn:${pnUser}`, lidUser)
				this.mappingCache.set(`lid:${lidUser}`, pnUser)
			}
		})
	}
	getLIDForPN(pn) {
		return __awaiter(this, void 0, void 0, function* () {
			var _a, _b
			return (
				((_b = (_a = yield this.getLIDsForPNs([pn])) === null || _a === void 0 ? void 0 : _a[0]) === null ||
				_b === void 0
					? void 0
					: _b.lid) || null
			)
		})
	}
	getLIDsForPNs(pns) {
		return __awaiter(this, void 0, void 0, function* () {
			if (pns.length === 0) return null
			const sortedPns = [...new Set(pns)].sort()
			const cacheKey = sortedPns.join(',')
			const inflight = this.inflightLIDLookups.get(cacheKey)
			if (inflight) {
				this.logger.trace(`Coalescing getLIDsForPNs request for ${sortedPns.length} PNs`)
				return inflight
			}
			const promise = this._getLIDsForPNsImpl(pns)
			this.inflightLIDLookups.set(cacheKey, promise)
			try {
				return yield promise
			} finally {
				this.inflightLIDLookups.delete(cacheKey)
			}
		})
	}
	_getLIDsForPNsImpl(pns) {
		return __awaiter(this, void 0, void 0, function* () {
			var _a, _b, _c
			const usyncFetch = {}
			const successfulPairs = {}
			const pending = []
			const addResolvedPair = (pn, decoded, lidUser) => {
				const normalizedLidUser = lidUser.toString()
				if (!normalizedLidUser) {
					this.logger.warn(`Invalid or empty LID user for PN ${pn}: lidUser = "${lidUser}"`)
					return false
				}
				// Push the PN device ID to the LID to maintain device separation
				const pnDevice = decoded.device !== undefined ? decoded.device : 0
				const deviceSpecificLid = `${normalizedLidUser}${!!pnDevice ? `:${pnDevice}` : ``}@${decoded.server === 'hosted' ? 'hosted.lid' : 'lid'}`
				this.logger.trace(`getLIDForPN: ${pn} → ${deviceSpecificLid} (user mapping with device ${pnDevice})`)
				successfulPairs[pn] = { lid: deviceSpecificLid, pn }
				return true
			}
			for (const pn of pns) {
				if (!isPnUser(pn) && !isHostedPnUser(pn)) continue
				const decoded = jidDecode(pn)
				if (!decoded) continue
				const pnUser = decoded.user
				const cached = this.mappingCache.get(`pn:${pnUser}`)
				if (cached && typeof cached === 'string') {
					if (!addResolvedPair(pn, decoded, cached)) {
						this.logger.warn(`Invalid entry for ${pn} (pair not resolved)`)
						continue
					}
					continue
				}
				pending.push({ pn, pnUser, decoded })
			}
			if (pending.length) {
				const pnUsers = [...new Set(pending.map(item => item.pnUser))]
				const stored = yield this.keys.get('lid-mapping', pnUsers)
				for (const pnUser of pnUsers) {
					const lidUser = stored[pnUser]
					if (lidUser && typeof lidUser === 'string') {
						this.mappingCache.set(`pn:${pnUser}`, lidUser)
						this.mappingCache.set(`lid:${lidUser}`, pnUser)
					}
				}
				for (const { pn, pnUser, decoded } of pending) {
					const cached = this.mappingCache.get(`pn:${pnUser}`)
					if (cached && typeof cached === 'string') {
						if (!addResolvedPair(pn, decoded, cached)) {
							this.logger.warn(`Invalid entry for ${pn} (pair not resolved)`)
							continue
						}
					} else {
						this.logger.trace(`No LID mapping found for PN user ${pnUser}; batch getting from USync`)
						const device = decoded.device || 0
						let normalizedPn = jidNormalizedUser(pn)
						if (isHostedPnUser(normalizedPn)) {
							normalizedPn = `${pnUser}@s.whatsapp.net`
						}
						if (!usyncFetch[normalizedPn]) {
							usyncFetch[normalizedPn] = [device]
						} else {
							;(_a = usyncFetch[normalizedPn]) === null || _a === void 0 ? void 0 : _a.push(device)
						}
					}
				}
			}
			if (Object.keys(usyncFetch).length > 0) {
				const result = yield (_b = this.pnToLIDFunc) === null || _b === void 0
					? void 0
					: _b.call(this, Object.keys(usyncFetch)) // this function already adds LIDs to mapping
				if (result && result.length > 0) {
					yield this.storeLIDPNMappings(result)
					for (const pair of result) {
						const pnDecoded = jidDecode(pair.pn)
						const pnUser = pnDecoded === null || pnDecoded === void 0 ? void 0 : pnDecoded.user
						if (!pnUser) continue
						const lidUser = (_c = jidDecode(pair.lid)) === null || _c === void 0 ? void 0 : _c.user
						if (!lidUser) continue
						for (const device of usyncFetch[pair.pn]) {
							const deviceSpecificLid = `${lidUser}${!!device ? `:${device}` : ``}@${device === 99 ? 'hosted.lid' : 'lid'}`
							this.logger.trace(
								`getLIDForPN: USYNC success for ${pair.pn} → ${deviceSpecificLid} (user mapping with device ${device})`
							)
							const deviceSpecificPn = `${pnUser}${!!device ? `:${device}` : ``}@${device === 99 ? 'hosted' : 's.whatsapp.net'}`
							successfulPairs[deviceSpecificPn] = { lid: deviceSpecificLid, pn: deviceSpecificPn }
						}
					}
				} else {
					this.logger.warn('USync fetch yielded no results for pending PNs')
				}
			}
			return Object.values(successfulPairs).length > 0 ? Object.values(successfulPairs) : null
		})
	}
	getPNForLID(lid) {
		return __awaiter(this, void 0, void 0, function* () {
			var _a, _b
			return (
				((_b = (_a = yield this.getPNsForLIDs([lid])) === null || _a === void 0 ? void 0 : _a[0]) === null ||
				_b === void 0
					? void 0
					: _b.pn) || null
			)
		})
	}
	getPNsForLIDs(lids) {
		return __awaiter(this, void 0, void 0, function* () {
			if (lids.length === 0) return null
			const sortedLids = [...new Set(lids)].sort()
			const cacheKey = sortedLids.join(',')
			const inflight = this.inflightPNLookups.get(cacheKey)
			if (inflight) {
				this.logger.trace(`Coalescing getPNsForLIDs request for ${sortedLids.length} LIDs`)
				return inflight
			}
			const promise = this._getPNsForLIDsImpl(lids)
			this.inflightPNLookups.set(cacheKey, promise)
			try {
				return yield promise
			} finally {
				this.inflightPNLookups.delete(cacheKey)
			}
		})
	}
	_getPNsForLIDsImpl(lids) {
		return __awaiter(this, void 0, void 0, function* () {
			const successfulPairs = {}
			const pending = []
			const addResolvedPair = (lid, decoded, pnUser) => {
				if (!pnUser || typeof pnUser !== 'string') {
					return false
				}
				const lidDevice = decoded.device !== undefined ? decoded.device : 0
				const pnJid = `${pnUser}:${lidDevice}@${decoded.domainType === WAJIDDomains.HOSTED_LID ? 'hosted' : 's.whatsapp.net'}`
				this.logger.trace(`Found reverse mapping: ${lid} → ${pnJid}`)
				successfulPairs[lid] = { lid, pn: pnJid }
				return true
			}
			for (const lid of lids) {
				if (!isLidUser(lid)) continue
				const decoded = jidDecode(lid)
				if (!decoded) continue
				const lidUser = decoded.user
				const cached = this.mappingCache.get(`lid:${lidUser}`)
				if (cached && typeof cached === 'string') {
					addResolvedPair(lid, decoded, cached)
					continue
				}
				pending.push({ lid, lidUser, decoded })
			}
			if (pending.length) {
				const reverseKeys = [...new Set(pending.map(item => `${item.lidUser}_reverse`))]
				const stored = yield this.keys.get('lid-mapping', reverseKeys)
				for (const { lid, lidUser, decoded } of pending) {
					let pnUser = this.mappingCache.get(`lid:${lidUser}`)
					if (!pnUser || typeof pnUser !== 'string') {
						pnUser = stored[`${lidUser}_reverse`]
						if (pnUser && typeof pnUser === 'string') {
							this.mappingCache.set(`lid:${lidUser}`, pnUser)
							this.mappingCache.set(`pn:${pnUser}`, lidUser)
						}
					}
					if (pnUser && typeof pnUser === 'string') {
						addResolvedPair(lid, decoded, pnUser)
					} else {
						this.logger.trace(`No reverse mapping found for LID user: ${lidUser}`)
					}
				}
			}
			return Object.values(successfulPairs).length ? Object.values(successfulPairs) : null
		})
	}
}
