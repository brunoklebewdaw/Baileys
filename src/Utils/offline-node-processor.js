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
/**
 * Creates a processor for offline stanza nodes that:
 * - Queues nodes for sequential processing
 * - Yields to the event loop periodically to avoid blocking
 * - Catches handler errors to prevent the processing loop from crashing
 */
export function makeOfflineNodeProcessor(nodeProcessorMap, deps, batchSize = 10) {
	const nodes = []
	let isProcessing = false
	const enqueue = (type, node) => {
		nodes.push({ type, node })
		if (isProcessing) {
			return
		}
		isProcessing = true
		const promise = () =>
			__awaiter(this, void 0, void 0, function* () {
				let processedInBatch = 0
				while (nodes.length && deps.isWsOpen()) {
					const { type, node } = nodes.shift()
					const nodeProcessor = nodeProcessorMap.get(type)
					if (!nodeProcessor) {
						deps.onUnexpectedError(new Error(`unknown offline node type: ${type}`), 'processing offline node')
						continue
					}
					yield nodeProcessor(node).catch(err => deps.onUnexpectedError(err, `processing offline ${type}`))
					processedInBatch++
					// Yield to event loop after processing a batch
					// This prevents blocking the event loop for too long when there are many offline nodes
					if (processedInBatch >= batchSize) {
						processedInBatch = 0
						yield deps.yieldToEventLoop()
					}
				}
				isProcessing = false
			})
		promise().catch(error => deps.onUnexpectedError(error, 'processing offline nodes'))
	}
	return { enqueue }
}
