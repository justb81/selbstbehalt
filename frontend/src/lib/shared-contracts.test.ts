// SPDX-License-Identifier: Apache-2.0
//
// Guards the cross-package wiring: the frontend must consume the *same* Zod
// schemas as the backend from @selbstbehalt/shared (issue #10). If module
// resolution to the shared package ever breaks, this test fails to import.

import { describe, expect, it } from 'vitest';

import {
  contractCreateSchema,
  invoiceStatusValues,
  type ContractCreate,
} from '@selbstbehalt/shared';

describe('@selbstbehalt/shared consumed from the frontend', () => {
  it('validates a contract form payload with the shared schema', () => {
    const payload: ContractCreate = {
      person_id: '3f9a8c2e-1d4b-4c6a-9e2f-7b1c0d5e6a7f',
      insurer_name: 'DKV',
      type: 'vollversicherung',
      start_date: '2024-01-01',
      monthly_premium: 450,
    };
    expect(contractCreateSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects an invalid payload', () => {
    expect(contractCreateSchema.safeParse({ insurer_name: '' }).success).toBe(false);
  });

  it('exposes the shared enum values', () => {
    expect(invoiceStatusValues).toContain('eingereicht');
  });
});
