var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Mutex as AsyncMutex } from 'async-mutex';
export const makeMutex = () => {
    const mutex = new AsyncMutex();
    return {
        mutex(code) {
            return mutex.runExclusive(code);
        }
    };
};
export const makeKeyedMutex = () => {
    const map = new Map();
    return {
        mutex(key, task) {
            return __awaiter(this, void 0, void 0, function* () {
                let entry = map.get(key);
                if (!entry) {
                    entry = { mutex: new AsyncMutex(), refCount: 0 };
                    map.set(key, entry);
                }
                entry.refCount++;
                try {
                    return yield entry.mutex.runExclusive(task);
                }
                finally {
                    entry.refCount--;
                    // only delete it if this is still the current entry
                    if (entry.refCount === 0 && map.get(key) === entry) {
                        map.delete(key);
                    }
                }
            });
        }
    };
};
