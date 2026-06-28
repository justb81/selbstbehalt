// SPDX-License-Identifier: Apache-2.0
//
// Typed fetch wrapper around the backend REST API (docs/design.md §7.1). Every
// response is parsed through a shared Zod schema (@selbstbehalt/shared, #10), so
// the data the UI receives is validated and fully typed. Errors are normalised
// to `ApiError`.

import type { ZodType } from 'zod';

import { ApiError, isApiErrorBody } from './errors.js';

export interface ApiClientOptions {
  /**
   * Backend base URL, or a function returning it. A function is resolved per
   * request so a changed server setting takes effect without rebuilding the
   * client.
   */
  baseUrl: string | (() => string);
  /**
   * Optional `X-API-Key` for external/VPN access (§7.2). A function is
   * resolved per request so a changed setting takes effect immediately.
   */
  apiKey?: string | (() => string | undefined);
  /** Injectable `fetch`, primarily for tests. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON request body; serialised automatically. */
  body?: unknown;
  /** Query parameters; `undefined`/`null` values are skipped. */
  query?: Record<string, QueryValue>;
  /** Zod schema the response body is validated with. Omit for empty responses. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  // Normalise so a base URL with a trailing slash doesn't produce a doubled
  // slash (`http://host//api/...` resolves to a different, 404-ing path). Every
  // caller benefits — not just the default instance whose store pre-trims.
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    // An HTTPException thrown without a message yields an empty `message`; fall
    // back to the status text so the UI never shows a blank error panel.
    if (isApiErrorBody(body)) return body.error.message || fallback;
  } catch {
    // Non-JSON or empty error body — fall back to the status text.
  }
  return fallback;
}

/** Build an API client bound to a base URL (and optional API key). */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const resolveBaseUrl = (): string =>
    typeof options.baseUrl === 'function' ? options.baseUrl() : options.baseUrl;
  const resolveApiKey = (): string | undefined => {
    const k = options.apiKey;
    if (!k) return undefined;
    return typeof k === 'function' ? k() : k;
  };

  async function request<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const { method = 'GET', body, query, schema, signal } = opts;
    const url = buildUrl(resolveBaseUrl(), path, query);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const apiKey = resolveApiKey();
    if (apiKey) headers['X-API-Key'] = apiKey;

    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Netzwerkfehler';
      throw new ApiError(`Verbindung zum Server fehlgeschlagen: ${message}`, 0, { cause });
    }

    if (!response.ok) {
      const message = await parseErrorMessage(
        response,
        response.statusText || 'Anfrage fehlgeschlagen',
      );
      throw new ApiError(message, response.status);
    }

    // No schema (or genuinely empty body) → nothing to parse.
    if (!schema || response.status === 204) return undefined as T;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new ApiError('Antwort des Servers war kein gültiges JSON', response.status, {
        isValidationError: true,
        cause,
      });
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        'Antwort des Servers entsprach nicht dem erwarteten Schema',
        response.status,
        {
          isValidationError: true,
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  }

  return { request };
}

export type ApiRequester = ReturnType<typeof createApiClient>['request'];
