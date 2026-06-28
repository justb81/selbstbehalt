// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-side wiring for the offline write-queue (issue #27): connectivity
 * stores plus the replay triggers — the `online` event and an initial flush on
 * load (which also drains anything left from a previous session). Replay only
 * runs while the app is open; queued writes persist in IndexedDB across sessions
 * and drain on the next open. (Background Sync is intentionally not used: the SW
 * can't reach the page's queue/base-URL when fired headless, so it would be dead
 * weight here.)
 */
import { browser } from '$app/environment';
import { writable, type Readable } from 'svelte/store';

import type { ApiRequester } from '$lib/api/client.js';

import { replayQueue } from './integration.js';
import type { OfflineQueue } from './queue.js';

const onlineStore = writable(browser ? navigator.onLine : true);
const pendingStore = writable(0);

/** `true` while the browser reports a network connection. */
export const isOnline: Readable<boolean> = { subscribe: onlineStore.subscribe };
/** Number of writes currently parked in the offline queue. */
export const pendingWrites: Readable<number> = { subscribe: pendingStore.subscribe };

/**
 * Wire connectivity + replay for the app-wide queue. Idempotent and a no-op
 * outside the browser; returns a teardown function.
 */
export function initOfflineSync(request: ApiRequester, queue: OfflineQueue): () => void {
  if (!browser) return () => {};

  let running = false;
  // Queue access is best-effort: if persistence is unavailable (IndexedDB
  // disabled, private mode, …) the app must keep working, just without an
  // offline queue — so store errors are swallowed rather than left to surface
  // as unhandled rejections.
  const refresh = async () => {
    try {
      pendingStore.set(await queue.size());
    } catch {
      /* queue store unavailable */
    }
  };

  const flush = async () => {
    if (running) return;
    running = true;
    try {
      await replayQueue(request, queue);
    } catch {
      /* transient/store error — retried on the next online event */
    } finally {
      running = false;
      await refresh();
    }
  };

  const onOnline = () => {
    onlineStore.set(true);
    void flush();
  };
  const onOffline = () => onlineStore.set(false);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // Reflect the starting state and drain anything left from a previous session.
  void refresh();
  if (navigator.onLine) void flush();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

/** Bump the pending-count store after an enqueue (wired from the API client). */
export function notifyEnqueued(): void {
  pendingStore.update((count) => count + 1);
}
