// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Server reachability as a first-class state (issue #381).
 *
 * `navigator.onLine` (`$lib/offline` → {@link isOnline}) answers "does this
 * device have a link?", not "did the backend answer?". With the backend down
 * and the WLAN up it stays `true`, so the offline hint never fires and the app
 * degrades silently — stale service-worker data next to values that failed to
 * load, both indistinguishable from a healthy page.
 *
 * The state is derived passively from real traffic; there is no poll and no
 * timer. Two signals feed it:
 *
 *   - the outcome of every request, via {@link wrapWithReachability} — the same
 *     `ApiRequester → ApiRequester` shape as `wrapWithOfflineQueue`;
 *   - the service worker's stale marker, via {@link noteApiResponse}.
 *
 * The marker is what makes this honest under the PWA: `networkFirst` serves a
 * cache fallback as a plain 200, so the fetch *succeeds*. Judged on the outcome
 * alone, an unreachable server would look reachable — including a `/api/health`
 * probe answered out of the cache.
 */
import { writable, type Readable } from 'svelte/store';

import { CACHED_AT_HEADER, STALE_HEADER } from '$lib/pwa/strategies.js';

import type { ApiRequester, RequestOptions } from './client.js';
import { ApiError } from './errors.js';

export interface ServerStatus {
  /** `null` until the first request settles — nothing is claimed before that. */
  reachable: boolean | null;
  /** The last answer came out of the service-worker cache, not from the server. */
  stale: boolean;
  /** When that cached copy was stored (ISO), for a "Stand: …" hint. */
  cachedAt: string | null;
  /** Counts unreachable → reachable transitions; a cue for pages to refetch. */
  recoveries: number;
}

const INITIAL: ServerStatus = { reachable: null, stale: false, cachedAt: null, recoveries: 0 };

/**
 * Statuses that mean the request did not reach a working backend: a reverse
 * proxy answering 502/503/504 is reporting that the backend behind it is down
 * (docs/architecture.md §7.3). Every other status — 4xx and a genuine 500 from a
 * route handler included — proves the backend answered. A network-level failure
 * produces no response at all and is handled in {@link wrapWithReachability}.
 */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

const store = writable<ServerStatus>({ ...INITIAL });

/** The app-wide server state. */
export const serverStatus: Readable<ServerStatus> = { subscribe: store.subscribe };

function markReachable(): void {
  store.update((s) =>
    s.reachable === true && !s.stale
      ? s
      : {
          ...s,
          reachable: true,
          stale: false,
          cachedAt: null,
          recoveries: s.reachable === false ? s.recoveries + 1 : s.recoveries,
        },
  );
}

function markUnreachable(patch: Partial<ServerStatus> = {}): void {
  store.update((s) => ({ ...s, reachable: false, ...patch }));
}

/**
 * Record what a response says about the server. A response carrying the service
 * worker's stale marker is *not* evidence the server answered — it is the
 * opposite, and it dates the data on screen.
 */
export function noteApiResponse(response: Response): void {
  if (response.headers.get(STALE_HEADER) === '1') {
    markUnreachable({ stale: true, cachedAt: response.headers.get(CACHED_AT_HEADER) });
    return;
  }
  if (GATEWAY_STATUSES.has(response.status)) {
    markUnreachable({ stale: false, cachedAt: null });
    return;
  }
  markReachable();
}

/**
 * Wrap an {@link ApiRequester} so a failed request feeds {@link serverStatus}.
 * Signature-preserving and observation-only: results and errors pass through
 * untouched.
 *
 * Only a network-level failure (status 0 — no response reached us) is judged
 * here. Everything that did produce a response was already classified by
 * {@link noteApiResponse}, which sees the headers this layer cannot; marking
 * again here would double-count and corrupt {@link ServerStatus.recoveries}.
 */
export function wrapWithReachability(request: ApiRequester): ApiRequester {
  return async function reachabilityAwareRequest<T = void>(
    path: string,
    opts: RequestOptions<T> = {},
  ): Promise<T> {
    try {
      return await request<T>(path, opts);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) markUnreachable();
      throw error;
    }
  };
}

/** Reset to the initial state. Test-only. */
export function resetServerStatus(): void {
  store.set({ ...INITIAL });
}
