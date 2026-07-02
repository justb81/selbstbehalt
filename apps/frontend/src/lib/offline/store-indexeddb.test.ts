// SPDX-License-Identifier: Apache-2.0
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { OfflineQueue, type QueuedWrite } from './queue.js';
import { createIndexedDbStore } from './store-indexeddb.js';

function write(id: string, path: string, at: string): QueuedWrite {
  return { id, method: 'POST', path, enqueuedAt: at };
}

describe('createIndexedDbStore', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    // A fresh in-memory IndexedDB per test for full isolation.
    factory = new IDBFactory();
  });

  it('round-trips writes in FIFO (insertion) order', async () => {
    const store = createIndexedDbStore(factory);
    await store.add(write('a', '/api/a', '2026-06-28T00:00:01.000Z'));
    await store.add(write('b', '/api/b', '2026-06-28T00:00:02.000Z'));
    await store.add(write('c', '/api/c', '2026-06-28T00:00:03.000Z'));

    expect((await store.all()).map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves insertion order even when enqueuedAt collides (same ms)', async () => {
    const store = createIndexedDbStore(factory);
    const sameMs = '2026-06-28T00:00:00.000Z';
    // ids are deliberately out of lexical order to prove ordering is by
    // insertion (auto-increment key), not by id or by the colliding timestamp.
    await store.add(write('zzz', '/api/1', sameMs));
    await store.add(write('aaa', '/api/2', sameMs));
    await store.add(write('mmm', '/api/3', sameMs));

    expect((await store.all()).map((w) => w.path)).toEqual(['/api/1', '/api/2', '/api/3']);
  });

  it('removes a single entry by id and clears all', async () => {
    const store = createIndexedDbStore(factory);
    await store.add(write('a', '/api/a', '2026-06-28T00:00:01.000Z'));
    await store.add(write('b', '/api/b', '2026-06-28T00:00:02.000Z'));

    await store.remove('a');
    expect((await store.all()).map((w) => w.id)).toEqual(['b']);

    await store.clear();
    expect(await store.all()).toEqual([]);
  });

  it('persists across store instances backed by the same database', async () => {
    await createIndexedDbStore(factory).add(write('a', '/api/a', '2026-06-28T00:00:01.000Z'));
    // A second store opening the same factory sees the persisted entry.
    expect((await createIndexedDbStore(factory).all()).map((w) => w.id)).toEqual(['a']);
  });

  it('drives the OfflineQueue end-to-end', async () => {
    const queue = new OfflineQueue(createIndexedDbStore(factory), {
      newId: () => 'fixed-id',
      now: () => '2026-06-28T00:00:00.000Z',
    });
    await queue.enqueue({ method: 'PUT', path: '/api/insured/1', body: { x: 1 } });

    const sent: string[] = [];
    const result = await queue.flush(async (w) => {
      sent.push(w.path);
    });
    expect(sent).toEqual(['/api/insured/1']);
    expect(result).toEqual({ flushed: 1, remaining: 0 });
  });

  it('rejects store operations when no IndexedDB factory is available', async () => {
    const store = createIndexedDbStore(undefined);
    await expect(store.all()).rejects.toThrow(/IndexedDB is unavailable/);
  });
});
