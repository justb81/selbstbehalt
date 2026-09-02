// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { contractTypeValues } from '../enums.js';
import { CONTRACT_TYPE_LABELS } from './contract-type.js';

describe('CONTRACT_TYPE_LABELS', () => {
  it('labels every contract type', () => {
    for (const type of contractTypeValues) {
      expect(CONTRACT_TYPE_LABELS[type]).toBeTruthy();
    }
    expect(CONTRACT_TYPE_LABELS.vollversicherung).toBe('Vollversicherung');
  });
});
