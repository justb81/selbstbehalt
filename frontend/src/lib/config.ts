// SPDX-License-Identifier: Apache-2.0
//
// Deploy-time configuration. The backend base URL is supplied via the
// PUBLIC_API_URL environment variable (see .env.example); a user can override
// it at runtime through the settings store.

import { env } from '$env/dynamic/public';

/** Local-dev default used when neither a saved setting nor PUBLIC_API_URL is set. */
export const FALLBACK_API_BASE_URL = 'http://localhost:8080';

/** The PUBLIC_API_URL value, or `undefined` when empty/unset. */
export function envApiBaseUrl(): string | undefined {
  const value = env.PUBLIC_API_URL?.trim();
  return value ? value : undefined;
}
