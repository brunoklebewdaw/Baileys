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
import { createHash } from 'crypto'
import { createWriteStream, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getBinaryNodeChild, getBinaryNodeChildren, getBinaryNodeChildString } from '../WABinary'
import { generateMessageIDV2 } from './generics'
import { getStream, getUrlFromDirectPath } from './messages-media'
export const parseCatalogNode = node => {
	const catalogNode = getBinaryNodeChild(node, 'product_catalog')
	const products = getBinaryNodeChildren(catalogNode, 'product').map(parseProductNode)
	const paging = getBinaryNodeChild(catalogNode, 'paging')
	return {
		products,
		nextPageCursor: paging ? getBinaryNodeChildString(paging, 'after') : undefined
	}
}
export const parseCollectionsNode = node => {
	const collectionsNode = getBinaryNodeChild(node, 'collections')
	const collections = getBinaryNodeChildren(collectionsNode, 'collection').map(collectionNode => {
		const id = getBinaryNodeChildString(collectionNode, 'id')
		const name = getBinaryNodeChildString(collectionNode, 'name')
		const products = getBinaryNodeChildren(collectionNode, 'product').map(parseProductNode)
		return {
			id,
			name,
			products,
			status: parseStatusInfo(collectionNode)
		}
	})
	return {
		collections
	}
}
export const parseOrderDetailsNode = node => {
	const orderNode = getBinaryNodeChild(node, 'order')
	const products = getBinaryNodeChildren(orderNode, 'product').map(productNode => {
		const imageNode = getBinaryNodeChild(productNode, 'image')
		return {
			id: getBinaryNodeChildString(productNode, 'id'),
			name: getBinaryNodeChildString(productNode, 'name'),
			imageUrl: getBinaryNodeChildString(imageNode, 'url'),
			price: +getBinaryNodeChildString(productNode, 'price'),
			currency: getBinaryNodeChildString(productNode, 'currency'),
			quantity: +getBinaryNodeChildString(productNode, 'quantity')
		}
	})
	const priceNode = getBinaryNodeChild(orderNode, 'price')
	const orderDetails = {
		price: {
			total: +getBinaryNodeChildString(priceNode, 'total'),
			currency: getBinaryNodeChildString(priceNode, 'currency')
		},
		products
	}
	return orderDetails
}
export const toProductNode = (productId, product) => {
	const attrs = {}
	const content = []
	if (typeof productId !== 'undefined') {
		content.push({
			tag: 'id',
			attrs: {},
			content: Buffer.from(productId)
		})
	}
	if (typeof product.name !== 'undefined') {
		content.push({
			tag: 'name',
			attrs: {},
			content: Buffer.from(product.name)
		})
	}
	if (typeof product.description !== 'undefined') {
		content.push({
			tag: 'description',
			attrs: {},
			content: Buffer.from(product.description)
		})
	}
	if (typeof product.retailerId !== 'undefined') {
		content.push({
			tag: 'retailer_id',
			attrs: {},
			content: Buffer.from(product.retailerId)
		})
	}
	if (product.images.length) {
		content.push({
			tag: 'media',
			attrs: {},
			content: product.images.map(img => {
				if (!('url' in img)) {
					throw new Boom('Expected img for product to already be uploaded', { statusCode: 400 })
				}
				return {
					tag: 'image',
					attrs: {},
					content: [
						{
							tag: 'url',
							attrs: {},
							content: Buffer.from(img.url.toString())
						}
					]
				}
			})
		})
	}
	if (typeof product.price !== 'undefined') {
		content.push({
			tag: 'price',
			attrs: {},
			content: Buffer.from(product.price.toString())
		})
	}
	if (typeof product.currency !== 'undefined') {
		content.push({
			tag: 'currency',
			attrs: {},
			content: Buffer.from(product.currency)
		})
	}
	if ('originCountryCode' in product) {
		if (typeof product.originCountryCode === 'undefined') {
			attrs['compliance_category'] = 'COUNTRY_ORIGIN_EXEMPT'
		} else {
			content.push({
				tag: 'compliance_info',
				attrs: {},
				content: [
					{
						tag: 'country_code_origin',
						attrs: {},
						content: Buffer.from(product.originCountryCode)
					}
				]
			})
		}
	}
	if (typeof product.isHidden !== 'undefined') {
		attrs['is_hidden'] = product.isHidden.toString()
	}
	const node = {
		tag: 'product',
		attrs,
		content
	}
	return node
}
export const parseProductNode = productNode => {
	const isHidden = productNode.attrs.is_hidden === 'true'
	const id = getBinaryNodeChildString(productNode, 'id')
	const mediaNode = getBinaryNodeChild(productNode, 'media')
	const statusInfoNode = getBinaryNodeChild(productNode, 'status_info')
	const product = {
		id,
		imageUrls: parseImageUrls(mediaNode),
		reviewStatus: {
			whatsapp: getBinaryNodeChildString(statusInfoNode, 'status')
		},
		availability: 'in stock',
		name: getBinaryNodeChildString(productNode, 'name'),
		retailerId: getBinaryNodeChildString(productNode, 'retailer_id'),
		url: getBinaryNodeChildString(productNode, 'url'),
		description: getBinaryNodeChildString(productNode, 'description'),
		price: +getBinaryNodeChildString(productNode, 'price'),
		currency: getBinaryNodeChildString(productNode, 'currency'),
		isHidden
	}
	return product
}
/**
 * Uploads images not already uploaded to WA's servers
 */
export function uploadingNecessaryImagesOfProduct(product_1, waUploadToServer_1) {
	return __awaiter(this, arguments, void 0, function* (product, waUploadToServer, timeoutMs = 30000) {
		product = Object.assign(Object.assign({}, product), {
			images: product.images
				? yield uploadingNecessaryImages(product.images, waUploadToServer, timeoutMs)
				: product.images
		})
		return product
	})
}
/**
 * Uploads images not already uploaded to WA's servers
 */
export const uploadingNecessaryImages = (images_1, waUploadToServer_1, ...args_1) =>
	__awaiter(
		void 0,
		[images_1, waUploadToServer_1, ...args_1],
		void 0,
		function* (images, waUploadToServer, timeoutMs = 30000) {
			const results = yield Promise.all(
				images.map(img =>
					__awaiter(void 0, void 0, void 0, function* () {
						var _a, e_1, _b, _c
						if ('url' in img) {
							const url = img.url.toString()
							if (url.includes('.whatsapp.net')) {
								return { url }
							}
						}
						const { stream } = yield getStream(img)
						const hasher = createHash('sha256')
						const filePath = join(tmpdir(), 'img' + generateMessageIDV2())
						const encFileWriteStream = createWriteStream(filePath)
						try {
							for (
								var _d = true, stream_1 = __asyncValues(stream), stream_1_1;
								(stream_1_1 = yield stream_1.next()), (_a = stream_1_1.done), !_a;
								_d = true
							) {
								_c = stream_1_1.value
								_d = false
								const block = _c
								hasher.update(block)
								encFileWriteStream.write(block)
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
						const sha = hasher.digest('base64')
						const { directPath } = yield waUploadToServer(filePath, {
							mediaType: 'product-catalog-image',
							fileEncSha256B64: sha,
							timeoutMs
						})
						yield fs.unlink(filePath).catch(err => console.log('Error deleting temp file ', err))
						return { url: getUrlFromDirectPath(directPath) }
					})
				)
			)
			return results
		}
	)
const parseImageUrls = mediaNode => {
	const imgNode = getBinaryNodeChild(mediaNode, 'image')
	return {
		requested: getBinaryNodeChildString(imgNode, 'request_image_url'),
		original: getBinaryNodeChildString(imgNode, 'original_image_url')
	}
}
const parseStatusInfo = mediaNode => {
	const node = getBinaryNodeChild(mediaNode, 'status_info')
	return {
		status: getBinaryNodeChildString(node, 'status'),
		canAppeal: getBinaryNodeChildString(node, 'can_appeal') === 'true'
	}
}
