// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Request-validation middleware shared by the route modules. Bodies and query
// strings are validated against the shared Zod schemas (#10) by the official
// `@hono/zod-validator`; its hook turns a failure into a 400 with a
// human-readable German message, normalised by the central error handler into
// `{ error: { status, message } }`. Validated input is read type-safely from
// `c.req.valid('json' | 'query')`.
//
// As middleware the check runs *before* the handler, so no guard can read a
// stale state between its check and an `await` on the request body (#407).

import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/** Flatten a ZodError into a single `field: message; field: message` string. */
function formatZodError(error: z.core.$ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * `application/json`, with an optional parameter such as `; charset=utf-8`.
 * Insisting on it makes every write endpoint unreachable for a cross-site
 * `<form>` post — a form can only send `multipart/form-data`,
 * `application/x-www-form-urlencoded` or `text/plain` — on top of the CSRF
 * middleware (#404).
 */
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

/** Validate the JSON request body; 415 on a non-JSON type, 400 on bad input. */
export function jsonBody<T extends z.ZodType>(schema: T) {
  return zValidator('json', schema, (result, c: Context) => {
    // Checked on success too: with the wrong Content-Type the validator sees an
    // empty body, which an all-optional update schema would happily accept.
    if (!JSON_CONTENT_TYPE.test(c.req.header('content-type')?.trim() ?? '')) {
      throw new HTTPException(415, { message: 'Content-Type muss application/json sein' });
    }
    if (!result.success) {
      throw new HTTPException(400, { message: formatZodError(result.error) });
    }
  });
}

/** Validate the query string against a schema, throwing a 400 on bad params. */
export function queryParams<T extends z.ZodType>(schema: T) {
  return zValidator('query', schema, (result) => {
    if (!result.success) {
      throw new HTTPException(400, { message: formatZodError(result.error) });
    }
  });
}
