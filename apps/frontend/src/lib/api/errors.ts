// SPDX-License-Identifier: Apache-2.0

import { errorBodySchema, type ErrorBody } from '@selbstbehalt/shared';

/**
 * The unified error envelope the backend returns. Defined once in
 * `@selbstbehalt/shared` so both sides parse the same wire contract.
 */
export type ApiErrorBody = ErrorBody;

/** Narrowing guard for the backend's `{ error: { status, message } }` shape. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return errorBodySchema.safeParse(value).success;
}

interface ApiErrorOptions {
  /** True when the response body could not be parsed/validated against the expected shape. */
  isValidationError?: boolean;
  cause?: unknown;
}

/**
 * Error thrown for any non-2xx API response, a network failure, or a response
 * that fails Zod validation. Carries the HTTP status (0 for network errors) so
 * callers and the UI can branch on it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly isValidationError: boolean;

  constructor(message: string, status: number, options: ApiErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.status = status;
    this.isValidationError = options.isValidationError ?? false;
  }
}
