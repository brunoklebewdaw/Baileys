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
import { Boom } from '@hapi/boom'
import { getBinaryNodeChild, S_WHATSAPP_NET } from '../WABinary'
const wMexQuery = (variables, queryId, query, generateMessageTag) => {
	return query({
		tag: 'iq',
		attrs: {
			id: generateMessageTag(),
			type: 'get',
			to: S_WHATSAPP_NET,
			xmlns: 'w:mex'
		},
		content: [
			{
				tag: 'query',
				attrs: { query_id: queryId },
				content: Buffer.from(JSON.stringify({ variables }), 'utf-8')
			}
		]
	})
}
export const executeWMexQuery = (variables, queryId, dataPath, query, generateMessageTag) =>
	__awaiter(void 0, void 0, void 0, function* () {
		var _a, _b
		const result = yield wMexQuery(variables, queryId, query, generateMessageTag)
		const child = getBinaryNodeChild(result, 'result')
		if (child === null || child === void 0 ? void 0 : child.content) {
			const data = JSON.parse(child.content.toString())
			if (data.errors && data.errors.length > 0) {
				const errorMessages = data.errors.map(err => err.message || 'Unknown error').join(', ')
				const firstError = data.errors[0]
				const errorCode = ((_a = firstError.extensions) === null || _a === void 0 ? void 0 : _a.error_code) || 400
				throw new Boom(`GraphQL server error: ${errorMessages}`, { statusCode: errorCode, data: firstError })
			}
			const response = dataPath
				? (_b = data === null || data === void 0 ? void 0 : data.data) === null || _b === void 0
					? void 0
					: _b[dataPath]
				: data === null || data === void 0
					? void 0
					: data.data
			if (typeof response !== 'undefined') {
				return response
			}
		}
		const action = (dataPath || '').startsWith('xwa2_')
			? dataPath.substring(5).replace(/_/g, ' ')
			: dataPath === null || dataPath === void 0
				? void 0
				: dataPath.replace(/_/g, ' ')
		throw new Boom(`Failed to ${action}, unexpected response structure.`, { statusCode: 400, data: result })
	})
