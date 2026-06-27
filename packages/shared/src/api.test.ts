// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { errorBodySchema, healthBodySchema } from './api.js';

describe('errorBodySchema', () => {
  it('accepts the unified error envelope', () => {
    expect(
      errorBodySchema.safeParse({ error: { status: 404, message: 'Not Found' } }).success,
    ).toBe(true);
  });

  it('accepts an empty message (an HTTPException thrown without one)', () => {
    expect(errorBodySchema.safeParse({ error: { status: 404, message: '' } }).success).toBe(true);
  });

  it('rejects a missing status or wrong types', () => {
    expect(errorBodySchema.safeParse({ error: { message: 'x' } }).success).toBe(false);
    expect(errorBodySchema.safeParse({ error: { status: '404', message: 'x' } }).success).toBe(
      false,
    );
    expect(errorBodySchema.safeParse('nope').success).toBe(false);
  });
});

describe('healthBodySchema', () => {
  it('accepts a healthy probe response', () => {
    expect(
      healthBodySchema.safeParse({ status: 'ok', service: 'selbstbehalt-backend', db: 'up' })
        .success,
    ).toBe(true);
  });

  it('accepts a degraded response', () => {
    expect(
      healthBodySchema.safeParse({
        status: 'degraded',
        service: 'selbstbehalt-backend',
        db: 'down',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown enum values', () => {
    expect(healthBodySchema.safeParse({ status: 'maybe', service: 'x', db: 'up' }).success).toBe(
      false,
    );
  });
});
