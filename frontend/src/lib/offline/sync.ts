// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-side wiring for the offline write-queue (issue #27): connectivity
 * stores plus the replay triggers (the `online` event, a Background Sync nudge
 * relayed by the service worker, and an initial flush on load).
 */
import { browser } from '$app/environment';
import { writable, type Readable } from 'svelte/store';

import type { ApiRequester } from '$lib/api/client.js';

import { replayQueue } from './integration.js';
import type { OfflineQueue } from './queue.js';

/** Background Sync tag the service worker listens for (see src/service-worker.ts). */
const REPLAY_TAG = 'replay-writes';

const onlineStore = writable(browser ? navigator.onLine : true);
const pendingStore = writable(0);

/** `true` while the browser reports a network connection. */
export const isOnline: Readable<boolean> = { subscribe: onlineStore.subscribe };
/** Number of writes currently parked in the offline queue. */
export const pendingWrites: Readable<number> = { subscribe: pendingStore.subscribe };

/** Best-effort Background Sync registration so replay survives a closed tab. */
async function requestBackgroundSync(): Promise<void> {
  if (!browser || !('serviceWorker' in navigator)) return;
  try {
    const registration = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    await registration.sync?.register(REPLAY_TAG);
  } catch {
    // SyncManager is unavailable (e.g. Firefox/Safari) — the `online` listener
    // and initial flush still drive replay while a tab is open.
  }
}

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
    void requestBackgroundSync();
    void flush();
  };
  const onOffline = () => onlineStore.set(false);
  const onMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'replay-queue') void flush();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  navigator.serviceWorker?.addEventListener('message', onMessage);

  // Reflect the starting state and drain anything left from a previous session.
  void refresh();
  if (navigator.onLine) void flush();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    navigator.serviceWorker?.removeEventListener('message', onMessage);
  };
}

/** Bump the pending-count store after an enqueue (wired from the API client). */
export function notifyEnqueued(): void {
  pendingStore.update((count) => count + 1);
}
