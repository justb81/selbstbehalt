// SPDX-License-Identifier: Apache-2.0
/**
 * GOÄ/GOZ/GOT invoice structure parser & validator — one of the two
 * domain-critical algorithms (see docs/design.md §4.3, CLAUDE.md).
 *
 * Pure, deterministic, **no LLM**. The parser is the consumer side of the
 * `fee-schedule/v1` format (see docs/data-format.md, `../data/fee-schedule`):
 * it
 *
 *  1. extracts invoice fields and line items from (OCR'd) text,
 *  2. looks each line up in a generated {@link FeeScheduleTable}
 *     (`../data/{goae,goz,got}.json`), normalising the Ziffer first,
 *  3. validates each position against the §5 multiplier limits **read from the
 *     table data** (`maxMultiplier` per entry, `multiplierLimits` per category)
 *     — never hard-coded, and
 *  4. validates the whole invoice against the cross-number dependency model
 *     (`constraints` per entry, `constraintGroups` spanning numbers).
 *
 * Both the per-position limits and the dependency rules live in the data, so
 * regenerating the tables (or adding GOZ/GOT) needs no parser change.
 *
 * ## Supported line layout
 *
 * A position line starts with a Ziffer and ends with a EUR amount, e.g.
 *
 * ```
 * 1    Beratung                 2,3    10,72
 * 250  Infusion        2x       1,8     8,40
 * ```
 *
 * The trailing run of numbers is read right-to-left as
 * `[… Anzahl] Faktor Betrag`. An explicit quantity marker (`2x` / `2×`)
 * is recognised anywhere in that run; otherwise a leading integer in a run of
 * three or more numbers is treated as the Anzahl. Provide a single total amount
 * per line (no separate Einzel-/Gesamtbetrag columns).
 */

import { roundCents, type BenefitCategory } from '@selbstbehalt/shared';

import type {
  Constraint,
  FeeCategory,
  FeeEntry,
  FeeScheduleId,
  FeeScheduleTable,
} from '../data/fee-schedule';

/** Floating-point tolerance for factor / amount comparisons. */
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A line item as extracted from text, before any table lookup. */
export interface RawPosition {
  /** Billing number exactly as it appeared in the text. */
  ziffer: string;
  /** Anzahl (quantity); defaults to 1 when not stated. */
  quantity: number;
  /** Steigerungsfaktor (multiplier). */
  multiplier: number;
  /** Amount charged on the line, in EUR. */
  chargedAmount: number;
  /** The raw source line, kept for auditing the extraction. */
  raw: string;
}

/** Why a single position was flagged during lookup / §5 validation. */
export type PositionFlagCode =
  'unknown_ziffer' | 'multiplier_exceeds_limit' | 'fixed_factor_mismatch';

/** A per-position flag with a human-readable German reason. */
export interface PositionFlag {
  code: PositionFlagCode;
  reason: string;
}

/** A line item enriched with table data and per-position validation results. */
export interface ParsedPosition {
  /** Billing number as it appeared in the text. */
  ziffer: string;
  /** Normalised lookup key (leading zeros stripped, lower-cased suffix). */
  normalizedZiffer: string;
  /** Service description from the matched {@link FeeEntry}, if known. */
  description?: string;
  /** Anzahl (quantity). */
  quantity: number;
  /** Steigerungsfaktor billed. */
  multiplier: number;
  /** Amount charged, EUR. */
  chargedAmount: number;
  /** 1.0× basis amount from the entry; null when the Ziffer is unknown. */
  baseAmount: number | null;
  /** §5 multiplier category from the entry; null when unknown. */
  category: FeeCategory | null;
  /**
   * Tariff benefit area from the entry — the schedule-derivable default the
   * Erstattungs-Engine groups by (§3.2 `included_benefits`). `null` when the
   * Ziffer is unknown; for GOÄ the engine may still override ambulant→stationär
   * from the invoice context. See {@link FeeEntry.benefitCategory}.
   */
  benefitCategory: BenefitCategory | null;
  /** Flagging threshold from the entry; null when unknown. */
  maxMultiplier: number | null;
  /** Whether the Ziffer was found in the table. */
  known: boolean;
  /** True iff the position carries no flags. */
  isValid: boolean;
  /** Per-position flags (unknown Ziffer, §5 limit, fixed-factor mismatch). */
  flags: PositionFlag[];
  /**
   * Service duration in minutes, if known. Not extracted from OCR text (it is
   * rarely on the line); set it from the review UI so `minDuration` constraints
   * can be checked. When absent, `minDuration` is skipped rather than guessed.
   */
  durationMinutes?: number;
  /** The raw source line. */
  raw?: string;
}

/** The type of cross-invoice rule a {@link ConstraintViolation} reports. */
export type ConstraintViolationType =
  | 'excludes' // excludes + mutualExclusion (incompatible numbers)
  | 'requires'
  | 'componentOf'
  | 'maxFrequency'
  | 'maxAmount'
  | 'minDuration'
  | 'ageLimit';

/** A whole-invoice constraint violation, citing the applied legal rule. */
export interface ConstraintViolation {
  type: ConstraintViolationType;
  /** Human-readable German explanation. */
  message: string;
  /** Quoted legal wording of the applied rule (`sourceText`). */
  sourceText: string;
  /** `constraintGroups` id, when the rule is a group rule. */
  ruleId?: string;
  /** Normalised Ziffern involved in the violation. */
  ziffern: string[];
  /** Indices into {@link ParsedInvoice.positions} involved. */
  positionIndices: number[];
}

/** Extra information the whole-invoice validation needs beyond the positions. */
export interface ValidationContext {
  /** Patient age in years at treatment time — required to check `ageLimit`. */
  patientAgeYears?: number;
}

/** The fully parsed and validated invoice. */
export interface ParsedInvoice {
  /** Which schedule the positions were validated against. */
  feeSchedule: FeeScheduleId;
  /** Invoice date as ISO `YYYY-MM-DD`, or null when none was found. */
  invoiceDate: string | null;
  invoiceNumber: string | null;
  providerName: string | null;
  positions: ParsedPosition[];
  /** Cross-number constraint violations over the whole invoice. */
  violations: ConstraintViolation[];
  /** Sum of all line amounts, EUR. */
  totalAmount: number;
}

// ---------------------------------------------------------------------------
// Number / Ziffer helpers
// ---------------------------------------------------------------------------

/**
 * Parses a German-formatted number ("1.234,56", "10,72", "2,3"). A lone dot is
 * read as a thousands separator only when it groups exactly three trailing
 * digits ("1.234"), otherwise as a decimal point ("10.72").
 */
export function parseGermanNumber(input: string): number {
  let s = input.trim().replace(/[€\s]/g, '');
  if (s === '') return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length > 1 && last.length === 3) {
      s = parts.join('');
    }
  }
  return Number(s);
}

/**
 * Normalises a Ziffer for lookup: strips leading zeros from the numeric part
 * and lower-cases a letter suffix, so "0001" and "1" match and "1829A" finds
 * "1829a" (see docs/data-format.md §4).
 */
export function normalizeZiffer(ziffer: string): string {
  return ziffer
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, '');
}

/** §5/§10 paragraph reference per schedule, for flag messages. */
function lawRef(schedule: FeeScheduleId): string {
  return schedule === 'GOT' ? '§10 GOT' : `§5 ${schedule}`;
}

/** German label for a {@link ConstraintScope}, for violation messages. */
function scopeLabel(scope: string): string {
  switch (scope) {
    case 'session':
      return 'je Sitzung';
    case 'day':
      return 'je Behandlungstag';
    case 'case':
      return 'im Behandlungsfall';
    case 'occasion':
      return 'je Inanspruchnahme';
    case 'year':
      return 'je Jahr';
    case 'lifetime':
      return 'je Lebenszeit';
    default:
      return `je ${scope}`;
  }
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

const DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
const LABELLED_DATE_RE =
  /(?:Rechnungsdatum|Rechnungs-?datum|Datum|vom)\D{0,12}(\d{1,2}\.\d{1,2}\.\d{2,4})/i;
const INVOICE_NO_RE =
  /(?:Rechnungs-?\s?(?:nummer|nr)|Rechnung\s+Nr|Beleg-?nr|Re-?Nr)\.?\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-/.]*)/i;
const PROVIDER_RE =
  /\b(?:Dr\.?\s?med\.?|Dr\.|Prof\.|Praxis(?:gemeinschaft)?|Gemeinschaftspraxis|MVZ|Zahnarzt|Zahnärztin|Tierarzt|Tierärztin|Tierklinik|Klinik|Klinikum)\b/i;

function toIso(day: string, month: string, year: string): string {
  let y = Number(year);
  if (y < 100) y += 2000;
  const d = day.padStart(2, '0');
  const m = month.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Extracts the header fields (date, number, provider) from invoice text. */
export function extractInvoiceFields(text: string): {
  invoiceDate: string | null;
  invoiceNumber: string | null;
  providerName: string | null;
} {
  const labelled = LABELLED_DATE_RE.exec(text);
  const labelledDate = labelled?.[1];
  const dateMatch = (labelledDate ? DATE_RE.exec(labelledDate) : null) ?? DATE_RE.exec(text);
  const invoiceDate =
    dateMatch && dateMatch[1] && dateMatch[2] && dateMatch[3]
      ? toIso(dateMatch[1], dateMatch[2], dateMatch[3])
      : null;

  const noMatch = INVOICE_NO_RE.exec(text);
  const invoiceNumber = noMatch?.[1] ?? null;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const providerName = lines.find((l) => PROVIDER_RE.test(l)) ?? lines[0] ?? null;

  return { invoiceDate, invoiceNumber, providerName };
}

// ---------------------------------------------------------------------------
// Position extraction
// ---------------------------------------------------------------------------

const ZIFFER_RE = /^\s*(\d{1,5}[a-zA-Z]?)\b/;

interface NumericToken {
  value: number;
  /** Token carried an explicit quantity marker ("x" / "×"). */
  isQuantityMarker: boolean;
  /** Token had no decimal separator. */
  integer: boolean;
}

function parseNumericToken(token: string): NumericToken | null {
  let s = token.trim().replace(/€/g, '');
  let isQuantityMarker = false;
  if (/[x×]/i.test(s)) {
    isQuantityMarker = true;
    s = s.replace(/[x×]/gi, '');
  }
  if (s === '' || !/^\d[\d.,]*$/.test(s)) return null;
  const value = parseGermanNumber(s);
  if (Number.isNaN(value)) return null;
  return { value, isQuantityMarker, integer: !/[.,]/.test(s) };
}

/** Parses one line into a {@link RawPosition}, or null if it is not one. */
export function parsePositionLine(line: string): RawPosition | null {
  const zm = ZIFFER_RE.exec(line);
  const ziffer = zm?.[1];
  if (!zm || ziffer === undefined) return null;
  const rest = line.slice(zm[0].length);
  const tokens = rest.split(/\s+/).filter(Boolean);

  // Gather the maximal trailing run of numeric tokens (stops at the first word,
  // so description text before the numbers is ignored).
  const trailing: NumericToken[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token === undefined) break;
    const parsed = parseNumericToken(token);
    if (!parsed) break;
    trailing.unshift(parsed);
  }

  const explicitQty = trailing.find((t) => t.isQuantityMarker);
  const core = trailing.filter((t) => !t.isQuantityMarker);
  // A position line needs at least a factor and an amount.
  const amountTok = core[core.length - 1];
  const factorTok = core[core.length - 2];
  if (!amountTok || !factorTok) return null;

  let quantity = 1;
  if (explicitQty) {
    quantity = explicitQty.value;
  } else if (core.length >= 3) {
    const qtyTok = core[0];
    if (qtyTok?.integer) quantity = qtyTok.value;
  }

  return {
    ziffer,
    quantity,
    multiplier: factorTok.value,
    chargedAmount: amountTok.value,
    raw: line.trim(),
  };
}

/** Extracts every position line from invoice text. */
export function extractPositions(text: string): RawPosition[] {
  const positions: RawPosition[] = [];
  for (const line of text.split(/\r?\n/)) {
    const p = parsePositionLine(line);
    if (p) positions.push(p);
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Lookup + §5 per-position validation
// ---------------------------------------------------------------------------

/** Builds a normalised Ziffer → entry index for a table. */
function buildIndex(table: FeeScheduleTable): Map<string, FeeEntry> {
  const index = new Map<string, FeeEntry>();
  for (const entry of Object.values(table.entries)) {
    index.set(normalizeZiffer(entry.ziffer), entry);
  }
  return index;
}

/**
 * Looks a {@link RawPosition} up in the table and runs the §5 per-position
 * checks. The flagging threshold comes from the entry's `maxMultiplier` (or, as
 * a fallback, the category's `regelhoechstsatz`) — never hard-coded. Entries
 * with a `fixedFactor` constraint are checked against that fixed factor instead.
 */
export function lookupPosition(
  raw: RawPosition,
  table: FeeScheduleTable,
  index: Map<string, FeeEntry> = buildIndex(table),
): ParsedPosition {
  const normalizedZiffer = normalizeZiffer(raw.ziffer);
  const entry = index.get(normalizedZiffer);
  const flags: PositionFlag[] = [];

  if (!entry) {
    flags.push({
      code: 'unknown_ziffer',
      reason: `Ziffer ${raw.ziffer} ist in der ${table.feeSchedule}-Tabelle nicht bekannt.`,
    });
    return {
      ziffer: raw.ziffer,
      normalizedZiffer,
      quantity: raw.quantity,
      multiplier: raw.multiplier,
      chargedAmount: raw.chargedAmount,
      baseAmount: null,
      category: null,
      benefitCategory: null,
      maxMultiplier: null,
      known: false,
      isValid: false,
      flags,
      raw: raw.raw,
    };
  }

  const fixed = entry.constraints?.find(
    (c): c is Extract<Constraint, { type: 'fixedFactor' }> => c.type === 'fixedFactor',
  );
  if (fixed) {
    if (Math.abs(raw.multiplier - fixed.factor) > EPS) {
      flags.push({
        code: 'fixed_factor_mismatch',
        reason:
          `Position ${entry.ziffer} ist nur mit festem Gebührensatz (${fixed.factor}) ` +
          `berechnungsfähig, abgerechnet wurde Faktor ${raw.multiplier}.`,
      });
    }
  } else {
    const limit =
      entry.maxMultiplier ?? table.multiplierLimits[entry.category]?.regelhoechstsatz ?? null;
    if (limit != null && raw.multiplier > limit + EPS) {
      flags.push({
        code: 'multiplier_exceeds_limit',
        reason: `Steigerungsfaktor ${raw.multiplier} überschreitet den Regelhöchstsatz ${limit} (${lawRef(table.feeSchedule)}).`,
      });
    }
  }

  return {
    ziffer: raw.ziffer,
    normalizedZiffer,
    description: entry.description,
    quantity: raw.quantity,
    multiplier: raw.multiplier,
    chargedAmount: raw.chargedAmount,
    baseAmount: entry.baseAmount,
    category: entry.category,
    benefitCategory: entry.benefitCategory,
    maxMultiplier: entry.maxMultiplier,
    known: true,
    isValid: flags.length === 0,
    flags,
    raw: raw.raw,
  };
}

// ---------------------------------------------------------------------------
// Whole-invoice constraint validation
// ---------------------------------------------------------------------------

/**
 * Validates a set of positions against the cross-number dependency model:
 * `excludes`/`mutualExclusion` (symmetric incompatibility), `requires`,
 * `componentOf`, `maxFrequency`, `maxAmount`, `minDuration` and `ageLimit`.
 *
 * Frequency and amount limits are evaluated treating the supplied positions as
 * a single scope window (one session/day/case); cross-invoice windowing is out
 * of scope here.
 */
export function validateInvoice(
  positions: ParsedPosition[],
  table: FeeScheduleTable,
  context: ValidationContext = {},
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const index = buildIndex(table);

  const indicesByZiffer = new Map<string, number[]>();
  positions.forEach((p, i) => {
    const arr = indicesByZiffer.get(p.normalizedZiffer) ?? [];
    arr.push(i);
    indicesByZiffer.set(p.normalizedZiffer, arr);
  });
  const present = new Set(indicesByZiffer.keys());

  // --- Incompatibility: excludes + mutualExclusion → symmetric pair set ---
  const PAIR_SEP = ' ';
  const conflictRule = new Map<string, { sourceText: string; ruleId?: string }>();
  const addPair = (a: string, b: string, rule: { sourceText: string; ruleId?: string }): void => {
    if (a === b) return;
    const key = [a, b].sort().join(PAIR_SEP);
    if (!conflictRule.has(key)) conflictRule.set(key, rule);
  };

  for (const ziffer of present) {
    const entry = index.get(ziffer);
    if (!entry?.constraints) continue;
    for (const c of entry.constraints) {
      if (c.type !== 'excludes') continue;
      for (const other of c.ziffern) {
        const no = normalizeZiffer(other);
        if (present.has(no)) addPair(ziffer, no, { sourceText: c.sourceText });
      }
    }
  }
  for (const group of table.constraintGroups) {
    if (group.type !== 'mutualExclusion') continue;
    const members = group.members.map(normalizeZiffer).filter((m) => present.has(m));
    for (let i = 0; i < members.length; i++) {
      const mi = members[i];
      if (mi === undefined) continue;
      for (let j = i + 1; j < members.length; j++) {
        const mj = members[j];
        if (mj === undefined) continue;
        addPair(mi, mj, { sourceText: group.sourceText, ruleId: group.id });
      }
    }
  }
  for (const [key, rule] of conflictRule) {
    const [a, b] = key.split(PAIR_SEP);
    if (a === undefined || b === undefined) continue;
    const positionIndices = [
      ...(indicesByZiffer.get(a) ?? []),
      ...(indicesByZiffer.get(b) ?? []),
    ].sort((x, y) => x - y);
    violations.push({
      type: 'excludes',
      message: `Die Ziffern ${a} und ${b} sind nicht nebeneinander berechnungsfähig.`,
      sourceText: rule.sourceText,
      ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
      ziffern: [a, b],
      positionIndices,
    });
  }

  // --- Per-entry constraints needing the whole invoice / context ---
  for (const [ziffer, idxs] of indicesByZiffer) {
    const entry = index.get(ziffer);
    if (!entry?.constraints) continue;
    for (const c of entry.constraints) {
      switch (c.type) {
        case 'requires': {
          if (!c.anyOf.some((x) => present.has(normalizeZiffer(x)))) {
            violations.push({
              type: 'requires',
              message: `Die Ziffer ${ziffer} ist ein Zuschlag und nur zusammen mit einer der Basisleistungen ${c.anyOf.join(', ')} berechnungsfähig.`,
              sourceText: c.sourceText,
              ziffern: [ziffer, ...c.anyOf],
              positionIndices: [...idxs],
            });
          }
          break;
        }
        case 'componentOf': {
          const hit = c.ziffern.map(normalizeZiffer).filter((x) => present.has(x));
          if (hit.length > 0) {
            const positionIndices = [
              ...idxs,
              ...hit.flatMap((h) => indicesByZiffer.get(h) ?? []),
            ].sort((x, y) => x - y);
            violations.push({
              type: 'componentOf',
              message: `Die Ziffer ${ziffer} ist Bestandteil der Leistung nach ${hit.join(', ')} und nicht separat berechnungsfähig.`,
              sourceText: c.sourceText,
              ziffern: [ziffer, ...hit],
              positionIndices,
            });
          }
          break;
        }
        case 'maxFrequency': {
          const count = idxs.reduce((sum, i) => sum + (positions[i]?.quantity || 1), 0);
          if (count > c.count) {
            violations.push({
              type: 'maxFrequency',
              message: `Die Ziffer ${ziffer} ist höchstens ${c.count}× ${scopeLabel(c.scope)} berechnungsfähig, abgerechnet ${count}×.`,
              sourceText: c.sourceText,
              ziffern: [ziffer],
              positionIndices: [...idxs],
            });
          }
          break;
        }
        case 'minDuration': {
          for (const i of idxs) {
            const d = positions[i]?.durationMinutes;
            if (d != null && d < c.minutes) {
              violations.push({
                type: 'minDuration',
                message: `Die Ziffer ${ziffer} setzt eine Mindestdauer von ${c.minutes} Minuten voraus (angegeben: ${d}).`,
                sourceText: c.sourceText,
                ziffern: [ziffer],
                positionIndices: [i],
              });
            }
          }
          break;
        }
        case 'ageLimit': {
          const age = context.patientAgeYears;
          if (age == null) break;
          if (c.maxAgeYears != null && age > c.maxAgeYears) {
            violations.push({
              type: 'ageLimit',
              message: `Die Ziffer ${ziffer} ist nur bis zum vollendeten ${c.maxAgeYears}. Lebensjahr berechnungsfähig (Patientenalter: ${age}).`,
              sourceText: c.sourceText,
              ziffern: [ziffer],
              positionIndices: [...idxs],
            });
          }
          if (c.minAgeYears != null && age < c.minAgeYears) {
            violations.push({
              type: 'ageLimit',
              message: `Die Ziffer ${ziffer} ist erst ab einem Alter von ${c.minAgeYears} Jahren berechnungsfähig (Patientenalter: ${age}).`,
              sourceText: c.sourceText,
              ziffern: [ziffer],
              positionIndices: [...idxs],
            });
          }
          break;
        }
        // excludes is handled above as a symmetric pair; fixedFactor is a
        // per-position check in lookupPosition.
        default:
          break;
      }
    }
  }

  // --- maxAmount groups (Höchstwert, 1.0× basis) ---
  for (const group of table.constraintGroups) {
    if (group.type !== 'maxAmount') continue;
    const members = group.members.map(normalizeZiffer).filter((m) => present.has(m));
    if (members.length === 0) continue;
    let sum = 0;
    const positionIndices: number[] = [];
    for (const m of members) {
      for (const i of indicesByZiffer.get(m) ?? []) {
        const p = positions[i];
        if (!p) continue;
        sum += (p.baseAmount ?? 0) * (p.quantity || 1);
        positionIndices.push(i);
      }
    }
    if (sum > group.amount + EPS) {
      violations.push({
        type: 'maxAmount',
        message: `Der Höchstwert von ${group.amount} EUR (1,0-fach) für die Nummern ${group.members.join(', ')} ist überschritten (Summe: ${roundCents(sum)} EUR).`,
        sourceText: group.sourceText,
        ruleId: group.id,
        ziffern: members,
        positionIndices: positionIndices.sort((x, y) => x - y),
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Parses (OCR'd) invoice text against a fee schedule: extracts fields and
 * positions, looks them up, runs §5 per-position checks and the whole-invoice
 * dependency validation.
 */
export function parseInvoice(
  text: string,
  table: FeeScheduleTable,
  context: ValidationContext = {},
): ParsedInvoice {
  const fields = extractInvoiceFields(text);
  const index = buildIndex(table);
  const positions = extractPositions(text).map((raw) => lookupPosition(raw, table, index));
  const violations = validateInvoice(positions, table, context);
  const totalAmount = roundCents(positions.reduce((sum, p) => sum + p.chargedAmount, 0));

  return {
    feeSchedule: table.feeSchedule,
    invoiceDate: fields.invoiceDate,
    invoiceNumber: fields.invoiceNumber,
    providerName: fields.providerName,
    positions,
    violations,
    totalAmount,
  };
}
