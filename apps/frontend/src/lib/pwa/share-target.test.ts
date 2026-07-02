// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  consumeSharedFile,
  storeSharedFile,
  type ShareCacheLike,
  type ShareRequestLike,
} from './share-target.js';

/** A minimal in-memory Cache keyed by string URL. */
function fakeCache(): ShareCacheLike {
  const store = new Map<string, Response>();
  return {
    async match(key) {
      return store.get(key);
    },
    async put(key, response) {
      store.set(key, response);
    },
    async delete(key) {
      return store.delete(key);
    },
  };
}

/**
 * A fake share-target POST — not a real `Request`, since actually
 * multipart-serialising a `FormData` through `new Request()` and re-parsing
 * it is the browser's job (jsdom's `File`/`FormData` don't round-trip
 * correctly through Node's `fetch` internals here); this exercises exactly
 * what `storeSharedFile` reads: `request.formData()`.
 */
function shareRequest(file: Blob | null): ShareRequestLike {
  const formData = new FormData();
  if (file) formData.set('pdf', file, 'invoice.pdf');
  return { formData: async () => formData };
}

describe('storeSharedFile', () => {
  it('stores the shared file under a fresh id', async () => {
    const cache = fakeCache();
    const file = new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' });
    const id = await storeSharedFile(shareRequest(file), cache, () => 'fixed-id');

    expect(id).toBe('fixed-id');
    const consumed = await consumeSharedFile(id, cache);
    expect(consumed).not.toBeNull();
    expect(consumed?.type).toBe('application/pdf');
    expect(await consumed?.text()).toBe('%PDF-1.4');
  });

  it('throws when the request carries no file', async () => {
    const cache = fakeCache();
    await expect(storeSharedFile(shareRequest(null), cache)).rejects.toThrow();
  });
});

describe('consumeSharedFile', () => {
  it('returns null for an unknown id', async () => {
    const cache = fakeCache();
    expect(await consumeSharedFile('missing', cache)).toBeNull();
  });

  it('is one-shot: a second consume of the same id returns null', async () => {
    const cache = fakeCache();
    const file = new File(['x'], 'invoice.pdf', { type: 'application/pdf' });
    const id = await storeSharedFile(shareRequest(file), cache, () => 'once');

    expect(await consumeSharedFile(id, cache)).not.toBeNull();
    expect(await consumeSharedFile(id, cache)).toBeNull();
  });
});
