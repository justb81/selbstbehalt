// SPDX-License-Identifier: Apache-2.0
/**
 * IndexedDB-backed {@link QueueStore} for the offline write-queue (issue #27).
 *
 * The database is opened lazily on first use so merely importing the app's API
 * client never touches IndexedDB (it also keeps SSR/unit-test imports inert).
 * Entries are keyed by their `id`; FIFO order is preserved by an `enqueuedAt`
 * index, falling back to insertion order for ties.
 */
import type { QueuedWrite, QueueStore } from './queue.js';

const DB_NAME = 'selbstbehalt-offline';
const STORE_NAME = 'writes';
const DB_VERSION = 1;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Build an IndexedDB-backed queue store. `factory` defaults to the global
 * `indexedDB` (and is injectable for tests); store operations reject if no
 * factory is available (IndexedDB disabled / unavailable).
 */
export function createIndexedDbStore(
  factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
): QueueStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    if (!factory) {
      return Promise.reject(new Error('IndexedDB is unavailable; offline queue cannot persist.'));
    }
    dbPromise = new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    });
    return dbPromise;
  }

  async function tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T> | T,
  ): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result: T;
      Promise.resolve(run(store)).then((value) => {
        result = value;
      }, reject);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  return {
    add(item) {
      return tx('readwrite', (store) => promisify(store.add(item)).then(() => undefined));
    },
    all() {
      return tx('readonly', async (store) => {
        const items = await promisify(store.index('enqueuedAt').getAll());
        return items as QueuedWrite[];
      });
    },
    remove(id) {
      return tx('readwrite', (store) => promisify(store.delete(id)).then(() => undefined));
    },
    clear() {
      return tx('readwrite', (store) => promisify(store.clear()).then(() => undefined));
    },
  };
}
