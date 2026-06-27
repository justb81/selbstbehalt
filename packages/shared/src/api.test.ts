// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  breHistorySchema,
  errorBodySchema,
  healthBodySchema,
  importResultSchema,
  yearStatsSchema,
} from './api.js';

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

describe('yearStatsSchema', () => {
  const valid = {
    year: 2026,
    invoice_count: 3,
    total_amount: 255,
    eligible_amount: 187.5,
    self_paid_amount: 67.5,
    refund_amount: 120,
    bre_amount: 452.3,
  };

  it('accepts a complete year roll-up', () => {
    expect(yearStatsSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects negative sums and non-integer counts', () => {
    expect(yearStatsSchema.safeParse({ ...valid, total_amount: -1 }).success).toBe(false);
    expect(yearStatsSchema.safeParse({ ...valid, invoice_count: 1.5 }).success).toBe(false);
  });
});

describe('breHistorySchema', () => {
  it('accepts a contract ladder with a nullable projection', () => {
    const result = breHistorySchema.safeParse({
      contract_id: '11111111-1111-1111-1111-111111111111',
      years: [
        { year: 2025, streak_months: 6, bre_amount: 0, projected_bre: 185 },
        { year: 2026, streak_months: 18, bre_amount: 185, projected_bre: null },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID contract id', () => {
    expect(breHistorySchema.safeParse({ contract_id: 'nope', years: [] }).success).toBe(false);
  });
});

describe('importResultSchema', () => {
  it('accepts an import result with and without a backup path', () => {
    expect(
      importResultSchema.safeParse({
        status: 'ok',
        tables_imported: 6,
        rows_imported: 42,
        backup_path: '/app/db/pkv.sqlite.bak-2026-06-27',
      }).success,
    ).toBe(true);
    expect(
      importResultSchema.safeParse({
        status: 'ok',
        tables_imported: 6,
        rows_imported: 0,
        backup_path: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a non-ok status', () => {
    expect(
      importResultSchema.safeParse({
        status: 'failed',
        tables_imported: 6,
        rows_imported: 0,
        backup_path: null,
      }).success,
    ).toBe(false);
  });
});
