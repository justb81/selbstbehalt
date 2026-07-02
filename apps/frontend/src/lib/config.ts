// SPDX-License-Identifier: Apache-2.0
//
// Deploy-time configuration. The backend base URL is supplied via the
// PUBLIC_API_URL environment variable (see .env.example); a user can override
// it at runtime through the settings store.

import { env } from '$env/dynamic/public';

/**
 * Default when neither a saved setting nor PUBLIC_API_URL is set: the empty
 * string means "same origin". The frontend's reverse proxy forwards `/api` to
 * the backend (nginx in prod, the Vite dev server in local dev), so the browser
 * only ever talks to its own origin — the reverse-proxy Basic Auth that protects
 * the app then also covers the API, and there is no CORS. Set PUBLIC_API_URL
 * only to point the browser at a *separate* backend origin (then pair it with an
 * X-API-Key and a CORS allow-list).
 */
export const FALLBACK_API_BASE_URL = '';

/** The PUBLIC_API_URL value, or `undefined` when empty/unset. */
export function envApiBaseUrl(): string | undefined {
  const value = env.PUBLIC_API_URL?.trim();
  return value ? value : undefined;
}
