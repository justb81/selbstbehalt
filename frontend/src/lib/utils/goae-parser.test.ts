// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import type {
  Constraint,
  ConstraintGroup,
  FeeCategory,
  FeeEntry,
  FeeScheduleId,
  FeeScheduleTable,
  MultiplierLimit,
} from '../data/fee-schedule';
import realGoae from '../data/goae.json';
import realGot from '../data/got.json';
import {
  buildIndex,
  extractInvoiceFields,
  extractPositions,
  isAuslagenersatzDescription,
  lookupPosition,
  normalizeZiffer,
  parseGermanNumber,
  parseInvoice,
  parsePositionLine,
  validateInvoice,
  validatePositions,
  type ParsedPosition,
  type RawPosition,
} from './goae-parser';

const goaeTable = realGoae as unknown as FeeScheduleTable;
const gotTable = realGot as unknown as FeeScheduleTable;

// ---------------------------------------------------------------------------
// Synthetic-table builders — let each constraint type be exercised in isolation
// with deterministic data, independent of table regeneration.
// ---------------------------------------------------------------------------

const STD_LIMITS: Record<FeeCategory, MultiplierLimit> = {
  default: { regelhoechstsatz: 2.3, hoechstsatz: 3.5 },
  technical: { regelhoechstsatz: 1.8, hoechstsatz: 2.5 },
  lab: { regelhoechstsatz: 1.15, hoechstsatz: 1.3 },
  inpatient: { regelhoechstsatz: 1.8, hoechstsatz: 2.5 },
};

function entry(ziffer: string, overrides: Partial<FeeEntry> = {}): FeeEntry {
  return {
    ziffer,
    description: `Leistung ${ziffer}`,
    points: 100,
    baseAmount: 5.83,
    category: 'default',
    benefitCategory: 'ambulant',
    maxMultiplier: 2.3,
    ...overrides,
  };
}

function makeTable(
  entries: FeeEntry[],
  constraintGroups: ConstraintGroup[] = [],
  feeSchedule: FeeScheduleId = 'GOÄ',
): FeeScheduleTable {
  return {
    schema: 'fee-schedule/v1',
    feeSchedule,
    version: 'test',
    source: {
      law: 'test',
      file: 'test',
      doknr: 'test',
      lawStatus: 'test',
      buildDate: 'test',
    },
    pointValueCents: feeSchedule === 'GOT' ? null : 5.82873,
    currency: 'EUR',
    multiplierLimits: STD_LIMITS,
    entries: Object.fromEntries(entries.map((e) => [e.ziffer, e])),
    constraintGroups,
  };
}

/**
 * Looks a single position up, building the index on the fly — a convenience for
 * the unit tests, which exercise tiny synthetic tables one position at a time.
 * Production callers must build the index once and thread it (see {@link buildIndex}).
 */
function look(raw: RawPosition, table: FeeScheduleTable): ParsedPosition {
  return lookupPosition(raw, table, buildIndex(table));
}

/** Build a ParsedPosition straight from raw values (skips text extraction). */
function pos(
  ziffer: string,
  table: FeeScheduleTable,
  overrides: { multiplier?: number; quantity?: number; durationMinutes?: number } = {},
): ParsedPosition {
  const p = look(
    {
      ziffer,
      quantity: overrides.quantity ?? 1,
      multiplier: overrides.multiplier ?? 1,
      chargedAmount: 0,
      raw: ziffer,
    },
    table,
  );
  if (overrides.durationMinutes != null) p.durationMinutes = overrides.durationMinutes;
  return p;
}

// ---------------------------------------------------------------------------
// Number / Ziffer helpers
// ---------------------------------------------------------------------------

describe('parseGermanNumber', () => {
  it('parses decimal comma', () => {
    expect(parseGermanNumber('10,72')).toBe(10.72);
    expect(parseGermanNumber('2,3')).toBe(2.3);
    expect(parseGermanNumber('1,15')).toBe(1.15);
  });

  it('parses thousands dot with decimal comma', () => {
    expect(parseGermanNumber('1.234,56')).toBe(1234.56);
    expect(parseGermanNumber('1.234.567,89')).toBe(1234567.89);
  });

  it('treats a lone grouping dot as thousands, a lone 2-digit dot as decimal', () => {
    expect(parseGermanNumber('1.234')).toBe(1234);
    expect(parseGermanNumber('10.72')).toBe(10.72);
  });

  it('strips currency symbols and whitespace', () => {
    expect(parseGermanNumber(' 10,72 € ')).toBe(10.72);
  });

  it('returns NaN for empty input', () => {
    expect(Number.isNaN(parseGermanNumber('  '))).toBe(true);
  });
});

describe('normalizeZiffer', () => {
  it('strips leading zeros', () => {
    expect(normalizeZiffer('0001')).toBe('1');
    expect(normalizeZiffer('0010')).toBe('10');
  });

  it('keeps and lower-cases letter suffixes', () => {
    expect(normalizeZiffer('1829A')).toBe('1829a');
    expect(normalizeZiffer('1829a')).toBe('1829a');
  });

  it('leaves a lone zero intact', () => {
    expect(normalizeZiffer('0')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

describe('extractInvoiceFields', () => {
  const text = [
    'Praxis Dr. med. Anna Beispiel',
    'Musterstraße 1, 12345 Berlin',
    'Rechnungsnummer: 2024-0815',
    'Rechnungsdatum: 27.06.2026',
    '',
    '1   Beratung   2,3   10,72',
  ].join('\n');

  it('extracts a labelled date as ISO', () => {
    expect(extractInvoiceFields(text).invoiceDate).toBe('2026-06-27');
  });

  it('extracts the invoice number', () => {
    expect(extractInvoiceFields(text).invoiceNumber).toBe('2024-0815');
  });

  it('extracts the provider line', () => {
    expect(extractInvoiceFields(text).providerName).toBe('Praxis Dr. med. Anna Beispiel');
  });

  it('expands a two-digit year', () => {
    expect(extractInvoiceFields('Datum 01.02.24').invoiceDate).toBe('2024-02-01');
  });

  it('falls back to the first non-empty line as provider, null date/number', () => {
    const fields = extractInvoiceFields('Irgendein Anbieter\nohne Datum');
    expect(fields.providerName).toBe('Irgendein Anbieter');
    expect(fields.invoiceDate).toBeNull();
    expect(fields.invoiceNumber).toBeNull();
  });

  it('returns null provider for empty text', () => {
    expect(extractInvoiceFields('').providerName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Position extraction
// ---------------------------------------------------------------------------

describe('parsePositionLine / extractPositions', () => {
  it('parses Ziffer, factor and amount', () => {
    expect(parsePositionLine('1   Beratung   2,3   10,72')).toEqual({
      ziffer: '1',
      quantity: 1,
      multiplier: 2.3,
      chargedAmount: 10.72,
      raw: '1   Beratung   2,3   10,72',
      ocrDescription: 'Beratung',
      treatmentDate: null,
      detectedSchedule: null,
    });
  });

  it('reads an explicit quantity marker', () => {
    const p = parsePositionLine('250  Infusion   2x   1,8   8,40');
    expect(p).toMatchObject({ ziffer: '250', quantity: 2, multiplier: 1.8, chargedAmount: 8.4 });
  });

  it('treats a leading integer in a three-number run as the quantity', () => {
    const p = parsePositionLine('250  Infusion   3   1,8   8,40');
    expect(p).toMatchObject({ quantity: 3, multiplier: 1.8, chargedAmount: 8.4 });
  });

  it('handles thousands separators in the amount', () => {
    const p = parsePositionLine('5000  Große OP   2,3   1.234,56');
    expect(p?.chargedAmount).toBe(1234.56);
  });

  it('keeps letter-suffixed Ziffern', () => {
    expect(parsePositionLine('1829a  Leistung  1,8  20,00')?.ziffer).toBe('1829a');
  });

  it('ignores lines without a trailing number run', () => {
    expect(parsePositionLine('Musterstraße 1, 12345 Berlin')).toBeNull();
    expect(parsePositionLine('Rechnungsdatum: 27.06.2026')).toBeNull();
  });

  it('ignores a lone number with no factor+amount pair', () => {
    expect(parsePositionLine('1 4,66')).toBeNull();
  });

  it('stops the trailing run at a malformed (NaN) number token', () => {
    const p = parsePositionLine('5  Foo  9,9,9  2,3  10,72');
    expect(p).toMatchObject({ ziffer: '5', multiplier: 2.3, chargedAmount: 10.72 });
  });

  it('keeps quantity 1 when the leading number of a three-number run is not an integer', () => {
    const p = parsePositionLine('250  Foo  1,5  1,8  8,40');
    expect(p).toMatchObject({ quantity: 1, multiplier: 1.8, chargedAmount: 8.4 });
  });

  it('extracts only the real position lines from a full invoice', () => {
    const text = [
      'Praxis Dr. Beispiel',
      '12345 Berlin',
      '1   Beratung   2,3   10,72',
      '5   Untersuchung   2,3   10,72',
      'Summe: 21,44',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions.map((p) => p.ziffer)).toEqual(['1', '5']);
  });

  // --- Real-world OCR format variations ---

  it('parses a Ä-prefixed GOÄ code (Factor Qty Amount column order)', () => {
    const p = parsePositionLine('Ä6 Vollständige Untersuchung 2,3000 1 13.41');
    expect(p).toMatchObject({ ziffer: '6', multiplier: 2.3, quantity: 1, chargedAmount: 13.41 });
  });

  it('strips an OK/UK region prefix before the Ziffer', () => {
    const p = parsePositionLine('OK 6050 Starke Einengung 3,5000 1 59,05');
    expect(p).toMatchObject({ ziffer: '6050', multiplier: 3.5, quantity: 1, chargedAmount: 59.05 });
  });

  it('strips a leading treatment date before the Ziffer', () => {
    const p = parsePositionLine('07.05.24 1 Beratung 2,3 10,72');
    expect(p).toMatchObject({ ziffer: '1', multiplier: 2.3, chargedAmount: 10.72 });
  });

  it('strips a date AND an OK/UK prefix before the Ziffer', () => {
    const p = parsePositionLine('25.01.24 OK 6050 Beschreibung 3,5000 1 59,05');
    expect(p).toMatchObject({ ziffer: '6050', multiplier: 3.5, quantity: 1, chargedAmount: 59.05 });
  });

  it('joins an orphaned bare-number amount onto the preceding line', () => {
    const text = [
      '07.05.24 Ä1 Beratung, auch mittels Fernsprecher 2,3000 1',
      '10.72',
      'Ä6 Vollständige Untersuchung eines spez. Organsystems 2,3000 1 13.41',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      ziffer: '1',
      multiplier: 2.3,
      quantity: 1,
      chargedAmount: 10.72,
    });
    expect(positions[1]).toMatchObject({
      ziffer: '6',
      multiplier: 2.3,
      quantity: 1,
      chargedAmount: 13.41,
    });
  });

  it('parses a line where € appears as a separate trailing token', () => {
    // PVS-style invoices print "26,14 €" with the € as a standalone token.
    // Before the fix the trailing-number loop stopped at € and returned null.
    const p = parsePositionLine('800 Eingeh. neurologische Untersuchung 2,30 26,14 €');
    expect(p).toMatchObject({ ziffer: '800', multiplier: 2.3, chargedAmount: 26.14, quantity: 1 });
  });

  it('joins a continuation line with € suffix onto the preceding line', () => {
    // OCR wraps "17,43 €" onto its own line; BARE_NUMBER_RE must match €.
    const text = ['75 Befundbericht 2,30', '17,43 €'].join('\n');
    const positions = extractPositions(text);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ ziffer: '75', multiplier: 2.3, chargedAmount: 17.43 });
  });

  it('joins a multi-number continuation line (factor + amount) onto the preceding line', () => {
    // OCR wraps both the factor and amount onto a single continuation line.
    const text = ['5298 Zuschlag bei digitaler Radiographie', '1,00 1,46 €'].join('\n');
    const positions = extractPositions(text);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ ziffer: '5298', multiplier: 1.0, chargedAmount: 1.46 });
  });

  it('parses a PVS-style invoice with € tokens, continuation lines, and a Ziffer-less line', () => {
    // Regression test for real PVS Baden-Württemberg invoice format. A line
    // without a leading Ziffer (OCR column-layout failure) that still
    // resolves its own Faktor + Betrag is kept — ziffer: '' — rather than
    // silently dropped (lookupPosition flags it for manual completion).
    const text = [
      '06.03.2026',
      'Beratung, auch mittels Fernsprecher 2,30 10,72 €',
      '800 Eingeh. neurologische Untersuchung 2,30 26,14 €',
      '831 Vegetative Funktionsdiagnostik 2,30 10,72 €',
      '75 Ausführl. Befund- od. Krankheitsbericht 2,30',
      '17,43 €',
      '5298 Zuschlag bei digitaler Radiographie',
      '1,00 1,46 €',
      '410 Ultraschalluntersuchung eines Organes',
      '3,00 34,97 €',
      '420 Ultraschalluntersuchung von bis zu drei 2,30 10,72 €',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions.map((p) => p.ziffer)).toEqual(['', '800', '831', '75', '5298', '410', '420']);
    expect(positions[0]).toMatchObject({ multiplier: 2.3, chargedAmount: 10.72 });
    expect(positions[1]).toMatchObject({ multiplier: 2.3, chargedAmount: 26.14 });
    expect(positions[3]).toMatchObject({ ziffer: '75', multiplier: 2.3, chargedAmount: 17.43 });
    expect(positions[4]).toMatchObject({ ziffer: '5298', multiplier: 1.0, chargedAmount: 1.46 });
    expect(positions[5]).toMatchObject({ ziffer: '410', multiplier: 3.0, chargedAmount: 34.97 });
  });

  it('rejects bare-integer boilerplate that happens to end in two numbers', () => {
    // IK-Nummer/Rechnungsnummer/IBAN fragments end in several plain integers
    // (no decimal comma) — must not be mistaken for a Ziffer-less position.
    expect(parsePositionLine('IK-Nummer: 2208 100 11')).toBeNull();
    expect(parsePositionLine('Rechnungsnummer: 32341-001348')).toBeNull();
    expect(parsePositionLine('IBAN: DE45 3006 0601 0001 6832 68')).toBeNull();
  });

  it('merges a two-line wrapped description onto the position above it', () => {
    // "5030 …1,80 37,77 €" wraps its Leistungslegende across two more lines
    // before "5298" starts the next position.
    const text = [
      '5030 Ob.-, Unt.arm, Ellenb., Ober-/Untersch, 1,80 37,77 €',
      'Kniegel, Hand/Fuß, Schulter, Schlüsselb',
      'Beckenteil, Kreuzb.,Hüftgel. 2 Ebenen',
      '5298 Zuschlag bei digitaler Radiographie 1,00 5,25 €',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions.map((p) => p.ziffer)).toEqual(['5030', '5298']);
    expect(positions[0]).toMatchObject({
      multiplier: 1.8,
      chargedAmount: 37.77,
      ocrDescription:
        'Ob.-, Unt.arm, Ellenb., Ober-/Untersch, Kniegel, Hand/Fuß, Schulter, Schlüsselb Beckenteil, Kreuzb.,Hüftgel. 2 Ebenen',
    });
  });

  it('merges a one-line wrapped description onto the position above it', () => {
    const text = [
      '5031 Kniegel, Hand/Fuß, Schulter, Schlüsselb Ob.-, Unt.arm, Ellenb., Ober-/Untersch, 1,80 10,49 €',
      'Beckenteil, Kreuzb.,Hüftgel. ergänz.Eb',
      '5298 Zuschlag bei digitaler Radiographie',
      '1,00 1,46 €',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions.map((p) => p.ziffer)).toEqual(['5031', '5298']);
    expect(positions[0]?.ocrDescription).toBe(
      'Kniegel, Hand/Fuß, Schulter, Schlüsselb Ob.-, Unt.arm, Ellenb., Ober-/Untersch, Beckenteil, Kreuzb.,Hüftgel. ergänz.Eb',
    );
  });

  it('merges description continuations that follow a bare-number-joined amount', () => {
    // "410 …Organes" has no amount of its own — the bare-number join fills
    // it in first, then the two following text-only lines merge onto it.
    const text = [
      '410 Ultraschalluntersuchung eines Organes',
      '3,00 34,97 €',
      'Sono Knie links und gegenseite zum',
      'Vergleich',
      '420 Ultraschalluntersuchung von bis zu drei 2,30 10,72 €',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions.map((p) => p.ziffer)).toEqual(['410', '420']);
    expect(positions[0]).toMatchObject({
      multiplier: 3.0,
      chargedAmount: 34.97,
      ocrDescription:
        'Ultraschalluntersuchung eines Organes Sono Knie links und gegenseite zum Vergleich',
    });
  });

  it('never merges trailing boilerplate after the last position on a page', () => {
    const text = [
      '420 Ultraschalluntersuchung von bis zu drei 2,30 10,72 €',
      'weiteren Organen, je Organe',
      'Bitte wenden!',
      'IBAN: DE45 3006 0601 0001 6832 68',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      ziffer: '420',
      ocrDescription: 'Ultraschalluntersuchung von bis zu drei',
    });
  });

  it('parses a realistic GOÄ/GOZ dental invoice with mixed prefixes and column order', () => {
    const text = [
      '25.01.24 OK 6050 Starke Einengung der Stützzonen. 3,5000 1 59,05',
      'UK 6050 Starke Einengung der Stützzonen. 3,5000 1 59,05',
      '6080 Einstellung der Kiefer, hoher Umfang 2,3000 1 38,81',
      'Ä1 Beratung, auch telefonisch 2,3000 1 10,72',
      'Ä5 Symptombezogene Untersuchung 2,3000 1 10,72',
      '4020 Lokalbehandlung von Mundschleimhauterkrankungen 2,3000 1 5,82',
      'Zwischensumme Honorar: 184,17',
    ].join('\n');
    const positions = extractPositions(text);
    expect(positions.map((p) => p.ziffer)).toEqual(['6050', '6050', '6080', '1', '5', '4020']);
    expect(positions[0]).toMatchObject({ multiplier: 3.5, quantity: 1, chargedAmount: 59.05 });
    expect(positions[3]).toMatchObject({
      ziffer: '1',
      multiplier: 2.3,
      quantity: 1,
      chargedAmount: 10.72,
    });
  });
});

// ---------------------------------------------------------------------------
// §5 per-position validation
// ---------------------------------------------------------------------------

describe('lookupPosition — §5 multiplier limits (all four categories)', () => {
  const table = makeTable([
    entry('1', { category: 'default', maxMultiplier: 2.3 }),
    entry('500', { category: 'technical', maxMultiplier: 1.8 }),
    entry('437', { category: 'lab', maxMultiplier: 1.15 }),
    entry('1000', { category: 'inpatient', maxMultiplier: 1.8 }),
  ]);

  const cases: Array<[string, number, boolean]> = [
    ['1', 2.3, true],
    ['1', 2.31, false],
    ['500', 1.8, true],
    ['500', 2.5, false],
    ['437', 1.15, true],
    ['437', 1.3, false],
    ['1000', 1.8, true],
    ['1000', 1.9, false],
  ];

  it.each(cases)('Ziffer %s at factor %s → valid=%s', (ziffer, multiplier, valid) => {
    const p = look({ ziffer, quantity: 1, multiplier, chargedAmount: 0, raw: '' }, table);
    expect(p.isValid).toBe(valid);
    if (!valid) {
      expect(p.flags[0]?.code).toBe('multiplier_exceeds_limit');
      expect(p.flags[0]?.reason).toContain('§5 GOÄ');
    }
  });

  it('copies baseAmount, category and maxMultiplier from the entry', () => {
    const p = look({ ziffer: '1', quantity: 1, multiplier: 2.3, chargedAmount: 0, raw: '' }, table);
    expect(p).toMatchObject({
      baseAmount: 5.83,
      category: 'default',
      maxMultiplier: 2.3,
      known: true,
    });
  });

  it('falls back to the category regelhoechstsatz when the entry has no maxMultiplier', () => {
    const t = makeTable([
      entry('1', { category: 'lab', maxMultiplier: undefined as unknown as number }),
    ]);
    const p = look({ ziffer: '1', quantity: 1, multiplier: 1.3, chargedAmount: 0, raw: '' }, t);
    expect(p.isValid).toBe(false);
    expect(p.flags[0]?.code).toBe('multiplier_exceeds_limit');
  });

  it('does not flag when neither the entry nor the category sets a limit', () => {
    const t = makeTable([entry('1', { maxMultiplier: undefined as unknown as number })]);
    t.multiplierLimits.default = { regelhoechstsatz: null, hoechstsatz: null };
    const p = look({ ziffer: '1', quantity: 1, multiplier: 9, chargedAmount: 0, raw: '' }, t);
    expect(p.isValid).toBe(true);
  });
});

describe('lookupPosition — unknown Ziffern', () => {
  const table = makeTable([entry('1')]);

  it('flags unknown Ziffern without crashing', () => {
    const p = look(
      { ziffer: '9999', quantity: 1, multiplier: 2.3, chargedAmount: 0, raw: '' },
      table,
    );
    expect(p.known).toBe(false);
    expect(p.isValid).toBe(false);
    expect(p.baseAmount).toBeNull();
    expect(p.category).toBeNull();
    expect(p.flags[0]?.code).toBe('unknown_ziffer');
  });

  it('matches despite leading zeros', () => {
    const p = look(
      { ziffer: '0001', quantity: 1, multiplier: 2.3, chargedAmount: 0, raw: '' },
      table,
    );
    expect(p.known).toBe(true);
  });

  it('flags a Ziffer-less fallback position instead of looking it up', () => {
    const p = look(
      { ziffer: '', quantity: 1, multiplier: 2.3, chargedAmount: 10.72, raw: '' },
      table,
    );
    expect(p.known).toBe(false);
    expect(p.isValid).toBe(false);
    expect(p.baseAmount).toBeNull();
    expect(p.flags[0]?.code).toBe('ziffer_not_detected');
    expect(p.chargedAmount).toBe(10.72);
  });
});

describe('lookupPosition — fixedFactor entries', () => {
  const fixed: Constraint = {
    type: 'fixedFactor',
    factor: 1,
    sourceText: 'nur mit dem einfachen Gebührensatz',
  };
  const table = makeTable([entry('52', { constraints: [fixed] })]);

  it('accepts the exact fixed factor (and skips the §5 limit check)', () => {
    const p = look({ ziffer: '52', quantity: 1, multiplier: 1, chargedAmount: 0, raw: '' }, table);
    expect(p.isValid).toBe(true);
  });

  it('flags a deviating factor', () => {
    const p = look(
      { ziffer: '52', quantity: 1, multiplier: 2.3, chargedAmount: 0, raw: '' },
      table,
    );
    expect(p.isValid).toBe(false);
    expect(p.flags[0]?.code).toBe('fixed_factor_mismatch');
  });
});

describe('isAuslagenersatzDescription — §10 GOÄ Auslagenersatz', () => {
  it('detects Porto/Versandkosten keywords', () => {
    expect(isAuslagenersatzDescription('Portopauschale')).toBe(true);
    expect(isAuslagenersatzDescription('Versandkosten')).toBe(true);
    expect(isAuslagenersatzDescription('Versandmaterial')).toBe(true);
    expect(isAuslagenersatzDescription('Verpackung und Versand')).toBe(true);
    expect(isAuslagenersatzDescription('Postgebühren')).toBe(true);
  });

  it('returns false for ordinary descriptions', () => {
    expect(isAuslagenersatzDescription('Beratung, auch mittels Fernsprecher')).toBe(false);
    expect(isAuslagenersatzDescription(null)).toBe(false);
    expect(isAuslagenersatzDescription(undefined)).toBe(false);
  });
});

describe('lookupPosition — GOT (no §5 threshold, flags only above the absolute max)', () => {
  it('accepts a high factor up to the GOT maximum and flags above it', () => {
    const ok = look(
      { ziffer: '1', quantity: 1, multiplier: 3, chargedAmount: 0, raw: '' },
      gotTable,
    );
    expect(ok.isValid).toBe(true);
    const bad = look(
      { ziffer: '1', quantity: 1, multiplier: 3.5, chargedAmount: 0, raw: '' },
      gotTable,
    );
    expect(bad.isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Whole-invoice constraint validation
// ---------------------------------------------------------------------------

describe('validateInvoice — excludes (symmetric)', () => {
  const ex: Constraint = {
    type: 'excludes',
    ziffern: ['30'],
    sourceText: 'Nr. 4 ist neben Nr. 30 nicht berechnungsfähig.',
  };

  it('detects a conflict when the edge is stored on the queried Ziffer', () => {
    const table = makeTable([entry('4', { constraints: [ex] }), entry('30')]);
    const v = validateInvoice([pos('4', table), pos('30', table)], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.type).toBe('excludes');
    expect(v[0]?.ziffern.sort()).toEqual(['30', '4']);
    expect(v[0]?.sourceText).toContain('nicht berechnungsfähig');
  });

  it('detects the same conflict when the edge is stored on the other Ziffer', () => {
    const exOnOther: Constraint = {
      type: 'excludes',
      ziffern: ['4'],
      sourceText: 'Nr. 30 neben Nr. 4 …',
    };
    const table = makeTable([entry('4'), entry('30', { constraints: [exOnOther] })]);
    const v = validateInvoice([pos('4', table), pos('30', table)], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.ziffern.sort()).toEqual(['30', '4']);
  });

  it('ignores a self-referential excludes edge', () => {
    const t = makeTable([
      entry('1', { constraints: [{ type: 'excludes', ziffern: ['1'], sourceText: 'x' }] }),
    ]);
    expect(validateInvoice([pos('1', t)], t)).toHaveLength(0);
  });

  it('does not flag when only one side of the pair is present', () => {
    const table = makeTable([entry('4', { constraints: [ex] }), entry('30')]);
    expect(validateInvoice([pos('4', table)], table)).toHaveLength(0);
  });

  it('reports each conflicting pair once, not per stored edge', () => {
    const a: Constraint = { type: 'excludes', ziffern: ['30'], sourceText: 'A' };
    const b: Constraint = { type: 'excludes', ziffern: ['4'], sourceText: 'B' };
    const table = makeTable([entry('4', { constraints: [a] }), entry('30', { constraints: [b] })]);
    expect(validateInvoice([pos('4', table), pos('30', table)], table)).toHaveLength(1);
  });
});

describe('validateInvoice — mutualExclusion group', () => {
  const group: ConstraintGroup = {
    id: 'excl-271-276',
    type: 'mutualExclusion',
    members: ['271', '272', '273', '274', '275', '276'],
    sourceText:
      'Die Leistungen nach den Nummern 271 bis 276 sind nicht nebeneinander berechnungsfähig.',
  };
  const table = makeTable(
    ['271', '272', '273', '274', '275', '276'].map((z) => entry(z)),
    [group],
  );

  it('flags any two present members and cites the rule id', () => {
    const v = validateInvoice([pos('271', table), pos('274', table)], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.ruleId).toBe('excl-271-276');
    expect(v[0]?.sourceText).toContain('271 bis 276');
  });

  it('flags every pair among three present members', () => {
    const v = validateInvoice([pos('271', table), pos('274', table), pos('276', table)], table);
    expect(v).toHaveLength(3);
  });

  it('does not flag a single present member', () => {
    expect(validateInvoice([pos('271', table)], table)).toHaveLength(0);
  });
});

describe('validateInvoice — requires (surcharge needs a base number)', () => {
  const req: Constraint = {
    type: 'requires',
    anyOf: ['100', '101'],
    sourceText: 'Zuschlag zu den Leistungen nach den Nummern 100 oder 101',
  };
  const table = makeTable([
    entry('102', { isSurcharge: true, constraints: [req] }),
    entry('100'),
    entry('101'),
  ]);

  it('passes when a base number is present', () => {
    expect(validateInvoice([pos('102', table), pos('100', table)], table)).toHaveLength(0);
  });

  it('flags when no base number is present', () => {
    const v = validateInvoice([pos('102', table)], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.type).toBe('requires');
    expect(v[0]?.sourceText).toContain('Zuschlag');
  });
});

describe('validateInvoice — componentOf', () => {
  const comp: Constraint = {
    type: 'componentOf',
    ziffern: ['270'],
    sourceText: '… ist Bestandteil der Leistung nach Nummer 270',
  };
  const table = makeTable([entry('200', { constraints: [comp] }), entry('270')]);

  it('flags when the including service is also billed', () => {
    const v = validateInvoice([pos('200', table), pos('270', table)], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.type).toBe('componentOf');
    expect(v[0]?.positionIndices).toEqual([0, 1]);
  });

  it('passes when the including service is absent', () => {
    expect(validateInvoice([pos('200', table)], table)).toHaveLength(0);
  });
});

describe('validateInvoice — maxFrequency', () => {
  const freq: Constraint = {
    type: 'maxFrequency',
    count: 1,
    scope: 'case',
    sourceText: 'im Behandlungsfall nur einmal',
  };
  const table = makeTable([entry('1', { constraints: [freq] })]);

  it('passes at the allowed count', () => {
    expect(validateInvoice([pos('1', table)], table)).toHaveLength(0);
  });

  it('flags when the summed quantity exceeds the limit', () => {
    const v = validateInvoice([pos('1', table, { quantity: 2 })], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.type).toBe('maxFrequency');
    expect(v[0]?.message).toContain('im Behandlungsfall');
  });

  it('sums quantity across repeated lines', () => {
    const v = validateInvoice([pos('1', table), pos('1', table)], table);
    expect(v).toHaveLength(1);
  });

  const scopeCases: Array<[string, string]> = [
    ['session', 'je Sitzung'],
    ['day', 'je Behandlungstag'],
    ['case', 'im Behandlungsfall'],
    ['occasion', 'je Inanspruchnahme'],
    ['year', 'je Jahr'],
    ['lifetime', 'je Lebenszeit'],
    ['implant', 'je implant'],
  ];

  it.each(scopeCases)('renders the German label for scope %s', (scope, label) => {
    const t = makeTable([
      entry('1', { constraints: [{ type: 'maxFrequency', count: 1, scope, sourceText: 'x' }] }),
    ]);
    const v = validateInvoice([pos('1', t, { quantity: 2 })], t);
    expect(v[0]?.message).toContain(label);
  });
});

describe('validateInvoice — maxAmount group (Höchstwert)', () => {
  const group: ConstraintGroup = {
    id: 'hoechstwert-3630-3631',
    type: 'maxAmount',
    members: ['3630', '3631'],
    amount: 11.66,
    scope: 'case',
    sourceText: 'Höchstwert für die Untersuchungen nach den Nummern 3630, 3631',
  };
  const table = makeTable(
    [entry('3630', { baseAmount: 6 }), entry('3631', { baseAmount: 6 })],
    [group],
  );

  it('passes under the cap', () => {
    expect(validateInvoice([pos('3630', table)], table)).toHaveLength(0);
  });

  it('ignores the group when no member is present', () => {
    expect(validateInvoice([pos('9999', table)], table)).toHaveLength(0);
  });

  it('flags when the summed 1.0× basis exceeds the cap', () => {
    const v = validateInvoice([pos('3630', table), pos('3631', table)], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.type).toBe('maxAmount');
    expect(v[0]?.ruleId).toBe('hoechstwert-3630-3631');
  });
});

describe('validateInvoice — minDuration', () => {
  const dur: Constraint = {
    type: 'minDuration',
    minutes: 20,
    sourceText: 'Mindestdauer 20 Minuten',
  };
  const table = makeTable([entry('3', { constraints: [dur] })]);

  it('flags a too-short duration', () => {
    const v = validateInvoice([pos('3', table, { durationMinutes: 10 })], table);
    expect(v).toHaveLength(1);
    expect(v[0]?.type).toBe('minDuration');
  });

  it('passes a sufficient duration', () => {
    expect(validateInvoice([pos('3', table, { durationMinutes: 25 })], table)).toHaveLength(0);
  });

  it('skips the check when no duration is known', () => {
    expect(validateInvoice([pos('3', table)], table)).toHaveLength(0);
  });
});

describe('validateInvoice — ageLimit', () => {
  const ageMax: Constraint = {
    type: 'ageLimit',
    maxAgeYears: 4,
    sourceText: 'bei Kindern bis zum vollendeten 4. Lebensjahr',
  };
  const ageMin: Constraint = {
    type: 'ageLimit',
    minAgeYears: 18,
    sourceText: 'ab dem 18. Lebensjahr',
  };
  const table = makeTable([
    entry('30', { constraints: [ageMax] }),
    entry('40', { constraints: [ageMin] }),
  ]);

  it('flags a patient over the max age', () => {
    const v = validateInvoice([pos('30', table)], table, { patientAgeYears: 10 });
    expect(v).toHaveLength(1);
    expect(v[0]?.type).toBe('ageLimit');
  });

  it('passes a patient within the max age', () => {
    expect(validateInvoice([pos('30', table)], table, { patientAgeYears: 3 })).toHaveLength(0);
  });

  it('flags a patient under a minimum age', () => {
    expect(validateInvoice([pos('40', table)], table, { patientAgeYears: 12 })).toHaveLength(1);
  });

  it('skips the check when the age is unknown', () => {
    expect(validateInvoice([pos('30', table)], table)).toHaveLength(0);
  });
});

describe('validatePositions', () => {
  const ex: Constraint = {
    type: 'excludes',
    ziffern: ['30'],
    sourceText: 'Nr. 1 neben Nr. 30 nicht berechnungsfähig.',
  };
  const table = makeTable([entry('1', { constraints: [ex] }), entry('30')]);

  it('rolls a whole-invoice violation into every position it involves', () => {
    const positions = [pos('1', table), pos('30', table)];
    const { positions: merged, violations } = validatePositions(
      positions,
      new Map([['GOÄ', table]]),
      new Map([['GOÄ', buildIndex(table)]]),
    );

    expect(violations).toHaveLength(1);
    expect(merged[0]?.isValid).toBe(false);
    expect(merged[0]?.flags.at(-1)).toMatchObject({ code: 'constraint_violation' });
    expect(merged[1]?.isValid).toBe(false);
  });

  it('leaves per-position flags untouched when there is no violation', () => {
    const positions = [pos('1', table)];
    const { positions: merged, violations } = validatePositions(
      positions,
      new Map([['GOÄ', table]]),
      new Map([['GOÄ', buildIndex(table)]]),
    );

    expect(violations).toHaveLength(0);
    expect(merged[0]).toBe(positions[0]); // unchanged reference, not just unchanged value
  });

  it('does not cross-check positions from a different schedule', () => {
    const gozTable = makeTable([entry('30')], [], 'GOZ');
    const positions = [pos('1', table), pos('30', gozTable)];
    const { violations } = validatePositions(
      positions,
      new Map([
        ['GOÄ', table],
        ['GOZ', gozTable],
      ]),
      new Map([
        ['GOÄ', buildIndex(table)],
        ['GOZ', buildIndex(gozTable)],
      ]),
    );

    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end + real-table integration
// ---------------------------------------------------------------------------

describe('parseInvoice — end to end on a synthetic table', () => {
  const ex: Constraint = {
    type: 'excludes',
    ziffern: ['30'],
    sourceText: 'Nr. 1 neben Nr. 30 nicht berechnungsfähig.',
  };
  const table = makeTable([entry('1', { constraints: [ex] }), entry('30')]);
  const text = [
    'Praxis Dr. med. Test',
    'Rechnungsnummer: R-1',
    'Rechnungsdatum: 27.06.2026',
    '1    Beratung      2,3    10,72',
    '30   Akupunktur    9,9    99,00',
  ].join('\n');

  const invoice = parseInvoice(text, table);

  it('fills the header fields', () => {
    expect(invoice).toMatchObject({
      feeSchedule: 'GOÄ',
      invoiceDate: '2026-06-27',
      invoiceNumber: 'R-1',
    });
  });

  it('parses positions and sums the total', () => {
    expect(invoice.positions).toHaveLength(2);
    expect(invoice.totalAmount).toBe(109.72);
  });

  it('flags the §5 overrun on the second line', () => {
    expect(invoice.positions[1]?.isValid).toBe(false);
    expect(invoice.positions[1]?.flags[0]?.code).toBe('multiplier_exceeds_limit');
  });

  it('reports the cross-number excludes violation', () => {
    expect(invoice.violations.some((v) => v.type === 'excludes')).toBe(true);
  });
});

describe('integration with the generated GOÄ table', () => {
  it('looks up a known Ziffer and flags an over-limit factor', () => {
    const p = look(
      { ziffer: '1', quantity: 1, multiplier: 3.5, chargedAmount: 0, raw: '' },
      goaeTable,
    );
    expect(p.known).toBe(true);
    expect(p.baseAmount).toBeGreaterThan(0);
    expect(p.isValid).toBe(false);
  });

  it('detects the real 1829 / 1829a mutual-exclusion group', () => {
    const positions = [
      look({ ziffer: '1829', quantity: 1, multiplier: 1.8, chargedAmount: 0, raw: '' }, goaeTable),
      look({ ziffer: '1829a', quantity: 1, multiplier: 1.8, chargedAmount: 0, raw: '' }, goaeTable),
    ];
    const v = validateInvoice(positions, goaeTable);
    expect(v.some((x) => x.type === 'excludes' && x.ruleId === 'excl-1829-1829a')).toBe(true);
  });

  it('detects previously-dropped fee-less billing numbers (GOÄ 5298 + the lab Katalog)', () => {
    // Percentage surcharge: point-less, priced 0, but detectable and carrying its
    // "requires a base position" rule — the concrete "5298 not detected" regression.
    const e5298 = goaeTable.entries['5298'];
    expect(e5298).toBeDefined();
    expect(e5298?.points).toBeNull();
    expect(e5298?.baseAmount).toBe(0);
    expect(e5298?.isSurcharge).toBe(true);
    expect(e5298?.constraints?.some((c) => c.type === 'requires')).toBe(true);
    const s = look(
      { ziffer: '5298', quantity: 1, multiplier: 1, chargedAmount: 0, raw: '' },
      goaeTable,
    );
    expect(s.known).toBe(true);
    expect(s.flags.some((f) => f.code === 'unknown_ziffer')).toBe(false);

    // Lab "Katalog" analyte: a real billing number priced from its method-header
    // rate (60 points → 3.50 EUR), category derived as lab (§5 Teil M).
    const lab = look(
      { ziffer: '3504', quantity: 1, multiplier: 1.15, chargedAmount: 0, raw: '' },
      goaeTable,
    );
    expect(lab.known).toBe(true);
    expect(lab.category).toBe('lab');
    expect(lab.baseAmount).toBeGreaterThan(0);

    // The laser surcharge 441 is likewise now detectable.
    expect(
      look({ ziffer: '441', quantity: 1, multiplier: 1, chargedAmount: 0, raw: '' }, goaeTable)
        .known,
    ).toBe(true);
  });

  it('parses a realistic GOÄ invoice without crashing on noise', () => {
    const text = [
      'Gemeinschaftspraxis Dr. med. Mustermann & Kollegen',
      'Beispielweg 3 · 80331 München',
      'Rechnung Nr. 2026/04711   vom 27.06.2026',
      '',
      'Pos  Leistung                       Faktor  Betrag',
      '1    Beratung                       2,3     10,72',
      '3    Eingehende Beratung            2,3     20,11',
      '9999 Unbekannte Ziffer              2,3     50,00',
      '',
      'Rechnungsbetrag: 80,83 EUR',
    ].join('\n');
    const invoice = parseInvoice(text, goaeTable);
    expect(invoice.invoiceNumber).toBe('2026/04711');
    expect(invoice.invoiceDate).toBe('2026-06-27');
    expect(invoice.positions.map((p) => p.ziffer)).toEqual(['1', '3', '9999']);
    expect(invoice.positions[2]?.known).toBe(false);
  });
});
