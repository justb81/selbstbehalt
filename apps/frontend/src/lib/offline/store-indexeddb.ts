// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * IndexedDB-backed {@link QueueStore} for the offline write-queue (issue #27).
 *
 * Built on `idb`, which wraps the event-based IndexedDB API in promises and
 * auto-commits a transaction once its awaited requests settle.
 *
 * The database is opened lazily on first use so merely importing the app's API
 * client never touches IndexedDB (it also keeps SSR/unit-test imports inert).
 *
 * FIFO is guaranteed by an **auto-incrementing** out-of-line primary key:
 * `getAll()` yields records in key (= insertion) order, so writes enqueued in
 * the same millisecond still replay in the order they were made. The `QueuedWrite.id`
 * is kept as an indexed property purely so a replayed entry can be removed.
 */
import { wrap, type DBSchema, type IDBPDatabase } from 'idb';

import type { QueuedWrite, QueueStore } from './queue.js';

const DB_NAME = 'selbstbehalt-offline';
const STORE_NAME = 'writes';
const ID_INDEX = 'id';
const DB_VERSION = 1;

interface QueueDb extends DBSchema {
  [STORE_NAME]: {
    key: number;
    value: QueuedWrite;
    indexes: { [ID_INDEX]: string };
  };
}

/**
 * Build an IndexedDB-backed queue store. `factory` defaults to the global
 * `indexedDB` (and is injectable for tests); store operations reject if no
 * factory is available (IndexedDB disabled / unavailable).
 */
export function createIndexedDbStore(
  factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
): QueueStore {
  let dbPromise: Promise<IDBPDatabase<QueueDb>> | null = null;

  function openDb(): Promise<IDBPDatabase<QueueDb>> {
    if (dbPromise) return dbPromise;
    if (!factory) {
      return Promise.reject(new Error('IndexedDB is unavailable; offline queue cannot persist.'));
    }
    // `idb`'s own openDB() always uses the global indexedDB, so open through the
    // injected factory and wrap the request instead.
    const request = factory.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Auto-incrementing key = strict insertion order; index `id` for removal.
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex(ID_INDEX, ID_INDEX, { unique: true });
      }
    });
    dbPromise = wrap(request) as Promise<IDBPDatabase<QueueDb>>;
    return dbPromise;
  }

  return {
    async add(item) {
      await (await openDb()).add(STORE_NAME, item);
    },
    async all() {
      // getAll() over the store returns records in auto-increment key order = FIFO.
      return (await openDb()).getAll(STORE_NAME);
    },
    async remove(id) {
      const tx = (await openDb()).transaction(STORE_NAME, 'readwrite');
      const key = await tx.store.index(ID_INDEX).getKey(id);
      if (key !== undefined) await tx.store.delete(key);
      await tx.done;
    },
    async clear() {
      await (await openDb()).clear(STORE_NAME);
    },
  };
}
