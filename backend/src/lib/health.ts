// SPDX-License-Identifier: Apache-2.0
export interface HealthResponse {
  status: 'ok';
  service: string;
}

/**
 * Builds the payload served by the backend health check.
 * The Hono `/health` route (#9) will return this verbatim.
 */
export function buildHealthResponse(service = 'selbstbehalt-backend'): HealthResponse {
  return { status: 'ok', service };
}
