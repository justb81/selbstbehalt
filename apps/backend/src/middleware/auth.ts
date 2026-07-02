// SPDX-License-Identifier: Apache-2.0
//
// Optional `X-API-Key` authentication (§7.2). The primary auth story is
// reverse-proxy HTTP Basic Auth (see #31); this middleware adds a single shared
// secret for external access via VPN/Tailscale. When no key is configured the
// middleware is a transparent pass-through (pure home-network operation).

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

const API_KEY_HEADER = 'x-api-key';

/**
 * Build the API-key middleware. Pass the configured key (or `undefined` to
 * disable the check). Uses a length-safe constant-time comparison.
 */
export function apiKeyAuth(apiKey: string | undefined) {
  return createMiddleware(async (c, next) => {
    if (!apiKey) {
      await next();
      return;
    }

    const provided = c.req.header(API_KEY_HEADER);
    if (!provided || !timingSafeEqual(provided, apiKey)) {
      throw new HTTPException(401, { message: 'Invalid or missing API key' });
    }

    await next();
  });
}

/** Constant-time string comparison to avoid leaking the key via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
