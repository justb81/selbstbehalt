// SPDX-License-Identifier: Apache-2.0
//
// Central error handling. Every error leaving a handler is normalised to a
// single JSON shape: `{ error: { status, message } }`. This is wired into the
// Hono app via `app.onError(...)` and `app.notFound(...)`.

import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ErrorBody {
  error: {
    status: number;
    message: string;
  };
}

function errorResponse(c: Context, status: ContentfulStatusCode, message: string) {
  const body: ErrorBody = { error: { status, message } };
  return c.json(body, status);
}

/** Converts thrown errors into the unified JSON error response. */
export const onError: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return errorResponse(c, err.status, err.message);
  }

  // Unexpected error: log server-side, return an opaque 500 to the client.
  console.error('Unhandled error:', err);
  return errorResponse(c, 500, 'Internal Server Error');
};

/** Unified 404 for unknown routes. */
export const notFound: NotFoundHandler = (c) => errorResponse(c, 404, 'Not Found');
