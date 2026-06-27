// SPDX-License-Identifier: Apache-2.0
//
// Public entry point for the API layer. Exposes a ready-to-use client wired to
// the configured backend base URL, plus the building blocks for ad-hoc clients
// (e.g. tests) and the error type.

import { resolveApiBaseUrl } from '$lib/stores/settings.js';

import { createApiClient } from './client.js';
import { createResources } from './resources.js';

/** Build a fully-wired client (requester + typed resource namespaces). */
export function createApi(options: Parameters<typeof createApiClient>[0]) {
  const { request } = createApiClient(options);
  return { request, ...createResources(request) };
}

/** The app-wide client; base URL resolves per request from settings/env. */
export const api = createApi({ baseUrl: () => resolveApiBaseUrl() });

export { createApiClient } from './client.js';
export { createResources, healthSchema } from './resources.js';
export type { Health, Resources } from './resources.js';
export type { ApiClientOptions, RequestOptions, QueryValue, ApiRequester } from './client.js';
export { ApiError, isApiErrorBody } from './errors.js';
export type { ApiErrorBody } from './errors.js';
