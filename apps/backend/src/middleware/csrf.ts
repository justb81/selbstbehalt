// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// CSRF protection for state-changing requests (§7.3, issue #404).
//
// The API has no cookie session, but two of the three documented auth modes
// still authenticate a request *ambiently*: with `API_KEY` unset (the default)
// nothing is required at all, and behind reverse-proxy Basic Auth the browser
// attaches the cached credentials to every same-origin request — no matter
// which page triggered it. CORS does not help there: a `multipart/form-data`
// POST is a CORS "simple request", so an auto-submitting `<form>` on a foreign
// page reaches the API without a preflight, and `CORS_ORIGINS` never sees it.
//
// Two layers close that:
//
//   1. `hono/csrf` — the standard middleware. It rejects form-shaped writes
//      (`multipart/form-data`, `application/x-www-form-urlencoded`,
//      `text/plain`) whose `Origin`/`Sec-Fetch-Site` do not vouch for
//      same-origin, i.e. exactly the requests a cross-site `<form>` can make.
//   2. `crossSiteWriteGuard` — every other unsafe method (the JSON writes).
//      Preflighted requests are only as safe as the CORS allow-list, and that
//      list defaults to `*`, so a bare `Sec-Fetch-Site` check is what actually
//      keeps a foreign page from issuing `fetch()` writes.
//
// Both consult the same allow-list: the API's own origin, plus whatever
// `CORS_ORIGINS` names explicitly. `CORS_ORIGINS=*` deliberately does *not*
// widen it — "any origin may read" is not "any web page may write" — so a
// separate-origin deployment (§7.2) has to name its frontend origin.

import type { Context, MiddlewareHandler } from 'hono';
import { csrf } from 'hono/csrf';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import type { Config } from '../config.js';

/** Methods that cannot change state and therefore need no CSRF check. */
const SAFE_METHOD = /^(GET|HEAD|OPTIONS)$/;

/** Rejection message, shared so both layers answer with the same text. */
const REJECTED =
  'Cross-Site-Schreibzugriff abgelehnt (CSRF-Schutz) — erlaubte Origins über CORS_ORIGINS konfigurieren';

/**
 * The origin the API is reached under. `c.req.url` carries the proxied scheme
 * (`http`) behind a TLS-terminating reverse proxy, which would not match the
 * browser's `https://…` `Origin` — so `X-Forwarded-Proto` wins when present.
 */
function requestOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedProto) url.protocol = `${forwardedProto}:`;
  return url.origin;
}

/** Origins allowed to send state-changing requests: own origin + allow-list. */
function allowedOriginCheck(config: Config) {
  const allowlist = config.corsOrigins === '*' ? [] : config.corsOrigins;
  return (origin: string, c: Context): boolean =>
    origin === requestOrigin(c) || allowlist.includes(origin);
}

/** `hono/csrf` bound to our allow-list — covers the form-shaped content types. */
export function csrfProtection(config: Config): MiddlewareHandler {
  const guard = csrf({ origin: allowedOriginCheck(config) });
  return createMiddleware(async (c, next) => {
    // `hono/csrf` reads a missing Content-Type as `text/plain` and then insists
    // on an `Origin`/`Sec-Fetch-Site` that vouches for the request — which
    // would reject a bodyless `DELETE` from curl, a request no `<form>` can
    // even produce (a form always sends a content type). Those are left to
    // `crossSiteWriteGuard`, which judges them by the browser headers alone.
    if (c.req.header('content-type') === undefined) {
      await next();
      return;
    }
    // `hono/csrf` rejects with a bare `Forbidden` body, which `onError` would
    // turn into an empty `message`. Re-throw with our own text — but only for
    // its own rejection, not for a 403 bubbling up from a route behind it.
    let reached = false;
    try {
      return await guard(c, async () => {
        reached = true;
        await next();
      });
    } catch (err) {
      if (!reached && err instanceof HTTPException && err.status === 403) {
        throw new HTTPException(403, { message: REJECTED });
      }
      throw err;
    }
  });
}

/**
 * Reject browser-initiated cross-site writes on *any* content type.
 *
 * `Sec-Fetch-Site` and `Origin` are forbidden header names, so a foreign page
 * can neither strip nor forge them; a request carrying neither is not
 * browser-initiated (curl, a script, the E2E API context) and passes through.
 */
export function crossSiteWriteGuard(config: Config): MiddlewareHandler {
  const isAllowedOrigin = allowedOriginCheck(config);
  return createMiddleware(async (c, next) => {
    const site = c.req.header('sec-fetch-site');
    const origin = c.req.header('origin');
    const browserInitiated = site !== undefined || origin !== undefined;
    const trusted =
      SAFE_METHOD.test(c.req.method) ||
      !browserInitiated ||
      site === 'same-origin' ||
      site === 'none' ||
      (origin !== undefined && isAllowedOrigin(origin, c));
    if (!trusted) {
      throw new HTTPException(403, { message: REJECTED });
    }
    await next();
  });
}
