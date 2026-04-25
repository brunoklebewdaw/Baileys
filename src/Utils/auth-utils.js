var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import NodeCache from '@cacheable/node-cache';
import { AsyncLocalStorage } from 'async_hooks';
import { Mutex } from 'async-mutex';
import { randomBytes } from 'crypto';
import PQueue from 'p-queue';
import { DEFAULT_CACHE_TTLS } from '../Defaults';
import { Curve, signedKeyPair } from './crypto';
import { delay, generateRegistrationId } from './generics';
import { PreKeyManager } from './pre-key-manager';
/**
 * Adds caching capability to a SignalKeyStore
 * @param store the store to add caching to
 * @param logger to log trace events
 * @param _cache cache store to use
 */
export function makeCacheableSignalKeyStore(store, logger, _cache) {
    const cache = _cache ||
        new NodeCache({
            stdTTL: DEFAULT_CACHE_TTLS.SIGNAL_STORE, // 5 minutes
            useClones: false,
            deleteOnExpire: true
        });
    // Mutex for protecting cache operations
    const cacheMutex = new Mutex();
    function getUniqueId(type, id) {
        return `${type}.${id}`;
    }
    return {
        get(type, ids) {
            return __awaiter(this, void 0, void 0, function* () {
                return cacheMutex.runExclusive(() => __awaiter(this, void 0, void 0, function* () {
                    const data = {};
                    const idsToFetch = [];
                    for (const id of ids) {
                        const item = (yield cache.get(getUniqueId(type, id)));
                        if (typeof item !== 'undefined') {
                            data[id] = item;
                        }
                        else {
                            idsToFetch.push(id);
                        }
                    }
                    if (idsToFetch.length) {
                        logger === null || logger === void 0 ? void 0 : logger.trace({ items: idsToFetch.length }, 'loading from store');
                        const fetched = yield store.get(type, idsToFetch);
                        for (const id of idsToFetch) {
                            const item = fetched[id];
                            if (item) {
                                data[id] = item;
                                // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                                yield cache.set(getUniqueId(type, id), item);
                            }
                        }
                    }
                    return data;
                }));
            });
        },
        set(data) {
            return __awaiter(this, void 0, void 0, function* () {
                return cacheMutex.runExclusive(() => __awaiter(this, void 0, void 0, function* () {
                    let keys = 0;
                    for (const type in data) {
                        for (const id in data[type]) {
                            yield cache.set(getUniqueId(type, id), data[type][id]);
                            keys += 1;
                        }
                    }
                    logger === null || logger === void 0 ? void 0 : logger.trace({ keys }, 'updated cache');
                    yield store.set(data);
                }));
            });
        },
        clear() {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                yield cache.flushAll();
                yield ((_a = store.clear) === null || _a === void 0 ? void 0 : _a.call(store));
            });
        }
    };
}
/**
 * Adds DB-like transaction capability to the SignalKeyStore
 * Uses AsyncLocalStorage for automatic context management
 * @param state the key store to apply this capability to
 * @param logger logger to log events
 * @returns SignalKeyStore with transaction capability
 */
export const addTransactionCapability = (state, logger, { maxCommitRetries, delayBetweenTriesMs }) => {
    const txStorage = new AsyncLocalStorage();
    // Queues for concurrency control (keyed by signal data type - bounded set)
    const keyQueues = new Map();
    // Transaction mutexes with reference counting for cleanup
    const txMutexes = new Map();
    const txMutexRefCounts = new Map();
    // Pre-key manager for specialized operations
    const preKeyManager = new PreKeyManager(state, logger);
    /**
     * Get or create a queue for a specific key type
     */
    function getQueue(key) {
        if (!keyQueues.has(key)) {
            keyQueues.set(key, new PQueue({ concurrency: 1 }));
        }
        return keyQueues.get(key);
    }
    /**
     * Get or create a transaction mutex
     */
    function getTxMutex(key) {
        if (!txMutexes.has(key)) {
            txMutexes.set(key, new Mutex());
            txMutexRefCounts.set(key, 0);
        }
        return txMutexes.get(key);
    }
    /**
     * Acquire a reference to a transaction mutex
     */
    function acquireTxMutexRef(key) {
        var _a;
        const count = (_a = txMutexRefCounts.get(key)) !== null && _a !== void 0 ? _a : 0;
        txMutexRefCounts.set(key, count + 1);
    }
    /**
     * Release a reference to a transaction mutex and cleanup if no longer needed
     */
    function releaseTxMutexRef(key) {
        var _a;
        const count = ((_a = txMutexRefCounts.get(key)) !== null && _a !== void 0 ? _a : 1) - 1;
        txMutexRefCounts.set(key, count);
        // Cleanup if no more references and mutex is not locked
        if (count <= 0) {
            const mutex = txMutexes.get(key);
            if (mutex && !mutex.isLocked()) {
                txMutexes.delete(key);
                txMutexRefCounts.delete(key);
            }
        }
    }
    /**
     * Check if currently in a transaction
     */
    function isInTransaction() {
        return !!txStorage.getStore();
    }
    /**
     * Commit transaction with retries
     */
    function commitWithRetry(mutations) {
        return __awaiter(this, void 0, void 0, function* () {
            if (Object.keys(mutations).length === 0) {
                logger.trace('no mutations in transaction');
                return;
            }
            logger.trace('committing transaction');
            for (let attempt = 0; attempt < maxCommitRetries; attempt++) {
                try {
                    yield state.set(mutations);
                    logger.trace({ mutationCount: Object.keys(mutations).length }, 'committed transaction');
                    return;
                }
                catch (error) {
                    const retriesLeft = maxCommitRetries - attempt - 1;
                    logger.warn(`failed to commit mutations, retries left=${retriesLeft}`);
                    if (retriesLeft === 0) {
                        throw error;
                    }
                    yield delay(delayBetweenTriesMs);
                }
            }
        });
    }
    return {
        get: (type, ids) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const ctx = txStorage.getStore();
            if (!ctx) {
                // No transaction - direct read without exclusive lock for concurrency
                return state.get(type, ids);
            }
            // In transaction - check cache first
            const cached = ctx.cache[type] || {};
            const missing = ids.filter(id => !(id in cached));
            if (missing.length > 0) {
                ctx.dbQueries++;
                logger.trace({ type, count: missing.length }, 'fetching missing keys in transaction');
                const fetched = yield getTxMutex(type).runExclusive(() => state.get(type, missing));
                // Update cache
                ctx.cache[type] = ctx.cache[type] || {};
                Object.assign(ctx.cache[type], fetched);
            }
            // Return requested ids from cache
            const result = {};
            for (const id of ids) {
                const value = (_a = ctx.cache[type]) === null || _a === void 0 ? void 0 : _a[id];
                if (value !== undefined && value !== null) {
                    result[id] = value;
                }
            }
            return result;
        }),
        set: (data) => __awaiter(void 0, void 0, void 0, function* () {
            const ctx = txStorage.getStore();
            if (!ctx) {
                // No transaction - direct write with queue protection
                const types = Object.keys(data);
                // Process pre-keys with validation
                for (const type_ of types) {
                    const type = type_;
                    if (type === 'pre-key') {
                        yield preKeyManager.validateDeletions(data, type);
                    }
                }
                // Write all data in parallel
                yield Promise.all(types.map(type => getQueue(type).add(() => __awaiter(void 0, void 0, void 0, function* () {
                    const typeData = { [type]: data[type] };
                    yield state.set(typeData);
                }))));
                return;
            }
            // In transaction - update cache and mutations
            logger.trace({ types: Object.keys(data) }, 'caching in transaction');
            for (const key_ in data) {
                const key = key_;
                // Ensure structures exist
                ctx.cache[key] = ctx.cache[key] || {};
                ctx.mutations[key] = ctx.mutations[key] || {};
                // Special handling for pre-keys
                if (key === 'pre-key') {
                    yield preKeyManager.processOperations(data, key, ctx.cache, ctx.mutations, true);
                }
                else {
                    // Normal key types
                    Object.assign(ctx.cache[key], data[key]);
                    Object.assign(ctx.mutations[key], data[key]);
                }
            }
        }),
        isInTransaction,
        transaction: (work, key) => __awaiter(void 0, void 0, void 0, function* () {
            const existing = txStorage.getStore();
            // Nested transaction - reuse existing context
            if (existing) {
                logger.trace('reusing existing transaction context');
                return work();
            }
            // New transaction - acquire mutex and create context
            const mutex = getTxMutex(key);
            acquireTxMutexRef(key);
            try {
                return yield mutex.runExclusive(() => __awaiter(void 0, void 0, void 0, function* () {
                    const ctx = {
                        cache: {},
                        mutations: {},
                        dbQueries: 0
                    };
                    logger.trace('entering transaction');
                    try {
                        const result = yield txStorage.run(ctx, work);
                        // Commit mutations
                        yield commitWithRetry(ctx.mutations);
                        logger.trace({ dbQueries: ctx.dbQueries }, 'transaction completed');
                        return result;
                    }
                    catch (error) {
                        logger.error({ error }, 'transaction failed, rolling back');
                        throw error;
                    }
                }));
            }
            finally {
                releaseTxMutexRef(key);
            }
        })
    };
};
export const initAuthCreds = () => {
    const identityKey = Curve.generateKeyPair();
    return {
        noiseKey: Curve.generateKeyPair(),
        pairingEphemeralKeyPair: Curve.generateKeyPair(),
        signedIdentityKey: identityKey,
        signedPreKey: signedKeyPair(identityKey, 1),
        registrationId: generateRegistrationId(),
        advSecretKey: randomBytes(32).toString('base64'),
        processedHistoryMessages: [],
        nextPreKeyId: 1,
        firstUnuploadedPreKeyId: 1,
        accountSyncCounter: 0,
        accountSettings: {
            unarchiveChats: false
        },
        registered: false,
        pairingCode: undefined,
        lastPropHash: undefined,
        routingInfo: undefined,
        additionalData: undefined
    };
};
