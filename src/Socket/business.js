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
import { getRawMediaUploadData } from '../Utils'
import {
	parseCatalogNode,
	parseCollectionsNode,
	parseOrderDetailsNode,
	parseProductNode,
	toProductNode,
	uploadingNecessaryImagesOfProduct
} from '../Utils/business'
import { jidNormalizedUser, S_WHATSAPP_NET } from '../WABinary'
import { getBinaryNodeChild } from '../WABinary/generic-utils'
import { makeMessagesRecvSocket } from './messages-recv'
export const makeBusinessSocket = config => {
	const sock = makeMessagesRecvSocket(config)
	const { authState, query, waUploadToServer } = sock
	const updateBussinesProfile = args =>
		__awaiter(void 0, void 0, void 0, function* () {
			const node = []
			const simpleFields = ['address', 'email', 'description']
			node.push(
				...simpleFields
					.filter(key => args[key] !== undefined && args[key] !== null)
					.map(key => ({
						tag: key,
						attrs: {},
						content: args[key]
					}))
			)
			if (args.websites !== undefined) {
				node.push(
					...args.websites.map(website => ({
						tag: 'website',
						attrs: {},
						content: website
					}))
				)
			}
			if (args.hours !== undefined) {
				node.push({
					tag: 'business_hours',
					attrs: { timezone: args.hours.timezone },
					content: args.hours.days.map(dayConfig => {
						const base = {
							tag: 'business_hours_config',
							attrs: {
								day_of_week: dayConfig.day,
								mode: dayConfig.mode
							}
						}
						if (dayConfig.mode === 'specific_hours') {
							return Object.assign(Object.assign({}, base), {
								attrs: Object.assign(Object.assign({}, base.attrs), {
									open_time: dayConfig.openTimeInMinutes,
									close_time: dayConfig.closeTimeInMinutes
								})
							})
						}
						return base
					})
				})
			}
			const result = yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'set',
					xmlns: 'w:biz'
				},
				content: [
					{
						tag: 'business_profile',
						attrs: {
							v: '3',
							mutation_type: 'delta'
						},
						content: node
					}
				]
			})
			return result
		})
	const updateCoverPhoto = photo =>
		__awaiter(void 0, void 0, void 0, function* () {
			const { fileSha256, filePath } = yield getRawMediaUploadData(photo, 'biz-cover-photo')
			const fileSha256B64 = fileSha256.toString('base64')
			const { meta_hmac, fbid, ts } = yield waUploadToServer(filePath, {
				fileEncSha256B64: fileSha256B64,
				mediaType: 'biz-cover-photo'
			})
			yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'set',
					xmlns: 'w:biz'
				},
				content: [
					{
						tag: 'business_profile',
						attrs: {
							v: '3',
							mutation_type: 'delta'
						},
						content: [
							{
								tag: 'cover_photo',
								attrs: { id: String(fbid), op: 'update', token: meta_hmac, ts: String(ts) }
							}
						]
					}
				]
			})
			return fbid
		})
	const removeCoverPhoto = id =>
		__awaiter(void 0, void 0, void 0, function* () {
			return yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'set',
					xmlns: 'w:biz'
				},
				content: [
					{
						tag: 'business_profile',
						attrs: {
							v: '3',
							mutation_type: 'delta'
						},
						content: [
							{
								tag: 'cover_photo',
								attrs: { op: 'delete', id }
							}
						]
					}
				]
			})
		})
	const getCatalog = _a =>
		__awaiter(void 0, [_a], void 0, function* ({ jid, limit, cursor }) {
			var _b
			jid = jid || ((_b = authState.creds.me) === null || _b === void 0 ? void 0 : _b.id)
			jid = jidNormalizedUser(jid)
			const queryParamNodes = [
				{
					tag: 'limit',
					attrs: {},
					content: Buffer.from((limit || 10).toString())
				},
				{
					tag: 'width',
					attrs: {},
					content: Buffer.from('100')
				},
				{
					tag: 'height',
					attrs: {},
					content: Buffer.from('100')
				}
			]
			if (cursor) {
				queryParamNodes.push({
					tag: 'after',
					attrs: {},
					content: cursor
				})
			}
			const result = yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'get',
					xmlns: 'w:biz:catalog'
				},
				content: [
					{
						tag: 'product_catalog',
						attrs: {
							jid,
							allow_shop_source: 'true'
						},
						content: queryParamNodes
					}
				]
			})
			return parseCatalogNode(result)
		})
	const getCollections = (jid_1, ...args_1) =>
		__awaiter(void 0, [jid_1, ...args_1], void 0, function* (jid, limit = 51) {
			var _a
			jid = jid || ((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.id)
			jid = jidNormalizedUser(jid)
			const result = yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'get',
					xmlns: 'w:biz:catalog',
					smax_id: '35'
				},
				content: [
					{
						tag: 'collections',
						attrs: {
							biz_jid: jid
						},
						content: [
							{
								tag: 'collection_limit',
								attrs: {},
								content: Buffer.from(limit.toString())
							},
							{
								tag: 'item_limit',
								attrs: {},
								content: Buffer.from(limit.toString())
							},
							{
								tag: 'width',
								attrs: {},
								content: Buffer.from('100')
							},
							{
								tag: 'height',
								attrs: {},
								content: Buffer.from('100')
							}
						]
					}
				]
			})
			return parseCollectionsNode(result)
		})
	const getOrderDetails = (orderId, tokenBase64) =>
		__awaiter(void 0, void 0, void 0, function* () {
			const result = yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'get',
					xmlns: 'fb:thrift_iq',
					smax_id: '5'
				},
				content: [
					{
						tag: 'order',
						attrs: {
							op: 'get',
							id: orderId
						},
						content: [
							{
								tag: 'image_dimensions',
								attrs: {},
								content: [
									{
										tag: 'width',
										attrs: {},
										content: Buffer.from('100')
									},
									{
										tag: 'height',
										attrs: {},
										content: Buffer.from('100')
									}
								]
							},
							{
								tag: 'token',
								attrs: {},
								content: Buffer.from(tokenBase64)
							}
						]
					}
				]
			})
			return parseOrderDetailsNode(result)
		})
	const productUpdate = (productId, update) =>
		__awaiter(void 0, void 0, void 0, function* () {
			update = yield uploadingNecessaryImagesOfProduct(update, waUploadToServer)
			const editNode = toProductNode(productId, update)
			const result = yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'set',
					xmlns: 'w:biz:catalog'
				},
				content: [
					{
						tag: 'product_catalog_edit',
						attrs: { v: '1' },
						content: [
							editNode,
							{
								tag: 'width',
								attrs: {},
								content: '100'
							},
							{
								tag: 'height',
								attrs: {},
								content: '100'
							}
						]
					}
				]
			})
			const productCatalogEditNode = getBinaryNodeChild(result, 'product_catalog_edit')
			const productNode = getBinaryNodeChild(productCatalogEditNode, 'product')
			return parseProductNode(productNode)
		})
	const productCreate = create =>
		__awaiter(void 0, void 0, void 0, function* () {
			// ensure isHidden is defined
			create.isHidden = !!create.isHidden
			create = yield uploadingNecessaryImagesOfProduct(create, waUploadToServer)
			const createNode = toProductNode(undefined, create)
			const result = yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'set',
					xmlns: 'w:biz:catalog'
				},
				content: [
					{
						tag: 'product_catalog_add',
						attrs: { v: '1' },
						content: [
							createNode,
							{
								tag: 'width',
								attrs: {},
								content: '100'
							},
							{
								tag: 'height',
								attrs: {},
								content: '100'
							}
						]
					}
				]
			})
			const productCatalogAddNode = getBinaryNodeChild(result, 'product_catalog_add')
			const productNode = getBinaryNodeChild(productCatalogAddNode, 'product')
			return parseProductNode(productNode)
		})
	const productDelete = productIds =>
		__awaiter(void 0, void 0, void 0, function* () {
			const result = yield query({
				tag: 'iq',
				attrs: {
					to: S_WHATSAPP_NET,
					type: 'set',
					xmlns: 'w:biz:catalog'
				},
				content: [
					{
						tag: 'product_catalog_delete',
						attrs: { v: '1' },
						content: productIds.map(id => ({
							tag: 'product',
							attrs: {},
							content: [
								{
									tag: 'id',
									attrs: {},
									content: Buffer.from(id)
								}
							]
						}))
					}
				]
			})
			const productCatalogDelNode = getBinaryNodeChild(result, 'product_catalog_delete')
			return {
				deleted: +(
					(productCatalogDelNode === null || productCatalogDelNode === void 0
						? void 0
						: productCatalogDelNode.attrs.deleted_count) || 0
				)
			}
		})
	return Object.assign(Object.assign({}, sock), {
		logger: config.logger,
		getOrderDetails,
		getCatalog,
		getCollections,
		productCreate,
		productDelete,
		productUpdate,
		updateBussinesProfile,
		updateCoverPhoto,
		removeCoverPhoto
	})
}
