// SPDX-License-Identifier: Apache-2.0
//
// Public entry point for the API layer. Exposes a ready-to-use client wired to
// the configured backend base URL, plus the building blocks for ad-hoc clients
// (e.g. tests) and the error type.

import { browser } from '$app/environment';

import {
  OfflineQueue,
  createIndexedDbStore,
  notifyEnqueued,
  wrapWithOfflineQueue,
} from '$lib/offline/index.js';
import { resolveApiBaseUrl } from '$lib/stores/settings.js';

import { createApiClient } from './client.js';
import { createResources } from './resources.js';

/** Build a fully-wired client (requester + typed resource namespaces). */
export function createApi(options: Parameters<typeof createApiClient>[0]) {
  const { request } = createApiClient(options);
  return { request, ...createResources(request) };
}

/**
 * App-wide offline write-queue. Its IndexedDB store is opened lazily on first
 * use, so importing the client (in SSR/tests) never touches IndexedDB.
 */
export const offlineQueue = new OfflineQueue(createIndexedDbStore());

/**
 * The raw, un-wrapped requester. Replay must go through this, NOT `api.request`:
 * replaying through the offline-wrapped requester would re-enqueue a duplicate
 * whenever a replay attempt itself fails offline. Used by `initOfflineSync`.
 */
export const offlineReplayRequester = createApiClient({
  baseUrl: () => resolveApiBaseUrl(),
}).request;

/**
 * The app-wide client; base URL resolves per request from settings/env. In the
 * browser, writes that fail while offline are queued and replayed on reconnect
 * (wired by `initOfflineSync`); a queued write rejects with `OfflineQueuedError`.
 */
function createAppApi() {
  const wrapped = browser
    ? wrapWithOfflineQueue(offlineReplayRequester, offlineQueue, {
        onEnqueue: () => notifyEnqueued(),
      })
    : offlineReplayRequester;
  return { request: wrapped, ...createResources(wrapped) };
}

export const api = createAppApi();

export { createApiClient } from './client.js';
export { createResources, healthSchema } from './resources.js';
export type { Health, Resources } from './resources.js';
export type { ApiClientOptions, RequestOptions, QueryValue, ApiRequester } from './client.js';
export { ApiError, isApiErrorBody } from './errors.js';
export type { ApiErrorBody } from './errors.js';
