// SPDX-License-Identifier: Apache-2.0
//
// Request-validation helpers shared by the route modules. JSON bodies and query
// strings are parsed through the shared Zod schemas (#10); any failure becomes a
// 400 with a human-readable message, normalised by the central error handler
// into `{ error: { status, message } }`.

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ZodError, ZodType } from 'zod';

/** Flatten a ZodError into a single `field: message; field: message` string. */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/** Read and validate the JSON request body, throwing a 400 on malformed input. */
export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Request-Body ist kein gültiges JSON' });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HTTPException(400, { message: formatZodError(result.error) });
  }
  return result.data;
}

/** Validate the query string against a schema, throwing a 400 on bad params. */
export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new HTTPException(400, { message: formatZodError(result.error) });
  }
  return result.data;
}
