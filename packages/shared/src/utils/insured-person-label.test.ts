// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { insuredPersonLabel } from './insured-person-label.js';

describe('insuredPersonLabel', () => {
  it('names the person, not her tariff', () => {
    expect(
      insuredPersonLabel({ person_name: 'Anna Muster', tariff_name: 'Komfort', kvnr: 'A1' }),
    ).toBe('Anna Muster');
  });

  it('distinguishes siblings on one tariff', () => {
    const tariff = { tariff_name: 'KinderSelect', kvnr: null };
    expect(insuredPersonLabel({ ...tariff, person_name: 'Anna' })).toBe('Anna');
    expect(insuredPersonLabel({ ...tariff, person_name: 'Ben' })).toBe('Ben');
  });

  it('falls back to tariff, then KVNR, then the generic term', () => {
    expect(insuredPersonLabel({ tariff_name: 'Komfort', kvnr: 'A1' })).toBe('Komfort');
    expect(insuredPersonLabel({ tariff_name: null, kvnr: 'A1' })).toBe('A1');
    // The row the bug report describes: no tariff, no KVNR — both optional.
    expect(insuredPersonLabel({ person_name: null, tariff_name: null, kvnr: null })).toBe(
      'Versicherte Person',
    );
    expect(insuredPersonLabel({})).toBe('Versicherte Person');
  });

  it('treats blank strings as absent', () => {
    expect(insuredPersonLabel({ person_name: '  ', tariff_name: 'Komfort' })).toBe('Komfort');
    expect(insuredPersonLabel({ person_name: '', tariff_name: ' ', kvnr: ' ' })).toBe(
      'Versicherte Person',
    );
  });

  it('trims the name it returns', () => {
    expect(insuredPersonLabel({ person_name: ' Anna Muster ' })).toBe('Anna Muster');
  });
});
