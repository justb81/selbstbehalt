// SPDX-License-Identifier: Apache-2.0
/**
 * Generic fee-schedule lookup format — shared by GOÄ, GOZ and GOT.
 *
 * These are the static, version-controlled tables the invoice parser (#16)
 * checks every line item against. They are generated reproducibly from the
 * official source XML under `data/input/` (see docs/data-format.md and
 * docs/design.md §4.4) — never hand-maintained.
 *
 * The format is deliberately one shape for all three schedules:
 *  - GOÄ / GOZ are point-based: `baseAmount = points × pointValueCents / 100`.
 *  - GOT lists euro amounts directly: `points` is null, `baseAmount` is the
 *    printed euro value.
 *
 * Its core job beyond pricing is to encode the *dependencies between billing
 * numbers* the law spells out in the "Allgemeine Bestimmungen" and inline
 * notes — e.g. "not billable alongside 30, 34", "only once per session",
 * surcharges that require a base number, group maximum values. Those live in
 * `Constraint` (per entry) and `ConstraintGroup` (spanning many numbers) so the
 * parser can validate a whole invoice, not just single lines.
 */

import type { BenefitCategory } from '@selbstbehalt/shared';

/** Which official fee schedule a table represents. */
export type FeeScheduleId = 'GOÄ' | 'GOZ' | 'GOT';

/**
 * §5 GOÄ/GOZ multiplier category. Determines the Steigerungsfaktor limits a
 * line item is checked against. GOT uses a single range and maps everything to
 * `default`.
 *  - `default`   – personal medical services (Regelhöchstsatz 2.3, max 3.5)
 *  - `technical` – medical-technical services (1.8 / 2.5)
 *  - `lab`       – laboratory, GOÄ Teil M (1.15 / 1.3)
 *  - `inpatient` – inpatient treatment (1.8 / 2.5)
 */
export type FeeCategory = 'default' | 'technical' | 'lab' | 'inpatient';

/**
 * Time window a frequency limit or maximum value applies to. Open-ended on
 * purpose: the schedules use a handful of common windows plus rare
 * domain-specific ones (e.g. per implant, per pregnancy). `case` is the
 * GOÄ Behandlungsfall (same illness within one month, §5 Allg. Best.).
 */
export type ConstraintScope =
  | 'session' // je Sitzung
  | 'day' // je (Behandlungs-)Tag
  | 'case' // im Behandlungsfall
  | 'occasion' // je Inanspruchnahme / Besuch
  | 'year'
  | 'lifetime'
  | (string & {});

/**
 * A machine-checkable dependency on a single entry. Every constraint carries
 * the original `sourceText` so the parser can surface the legal wording and a
 * human can audit the extraction.
 */
export type Constraint =
  /** Not billable alongside any of `ziffern` ("neben den Leistungen nach …
   *  nicht berechnungsfähig"). This is a *star*: it says nothing about whether
   *  the listed numbers conflict with each other. Billing incompatibility is
   *  symmetric, so the parser must treat a `(this, X)` conflict as a violation
   *  regardless of which side stores the edge (the law usually states it once).
   *  For a fully-connected block where every number excludes every other, use a
   *  `mutualExclusion` {@link ConstraintGroup} instead — see docs/data-format.md §5.2.1. */
  | { type: 'excludes'; ziffern: string[]; scope?: ConstraintScope; sourceText: string }
  /** Surcharge / add-on: only billable together with at least one of `anyOf`. */
  | { type: 'requires'; anyOf: string[]; sourceText: string }
  /** Already included in another service; not separately billable when one of
   *  `ziffern` is billed ("… ist Bestandteil der Leistung nach Nummer …"). */
  | { type: 'componentOf'; ziffern: string[]; sourceText: string }
  /** At most `count` times per `scope` ("nur einmal je Sitzung", "je
   *  Behandlungstag", "im Behandlungsfall nur einmal"). */
  | { type: 'maxFrequency'; count: number; scope: ConstraintScope; sourceText: string }
  /** Minimum time the service must take to be billable ("mindestens 20 Min."). */
  | { type: 'minDuration'; minutes: number; sourceText: string }
  /** Only billable for patients up to `maxAgeYears` (typical for Zuschläge). */
  | { type: 'ageLimit'; maxAgeYears?: number; minAgeYears?: number; sourceText: string }
  /** Billable only with a fixed Gebührensatz, i.e. not subject to the
   *  Steigerungsfaktor ("nur mit dem einfachen Gebührensatz berechnungsfähig"). */
  | { type: 'fixedFactor'; factor: number; sourceText: string };

/** Discriminator union tag for {@link Constraint}, handy for exhaustive checks. */
export type ConstraintType = Constraint['type'];

/** The section of the schedule an entry sits in (drives §5 category, audit). */
export interface FeeSection {
  /** Top-level part, e.g. GOÄ Teil "M" (Labor); unset for GOZ/GOT. */
  part?: string;
  /** Section/subsection label as printed, e.g. GOÄ "B I", GOZ part "F". */
  code?: string;
  /** Human title, e.g. "Laboratoriumsuntersuchungen". */
  title?: string;
}

/** One billing number (Ziffer) in a fee schedule. Keyed by `ziffer` in the table. */
export interface FeeEntry {
  /** Canonical billing number exactly as printed in the source, e.g. "1",
   *  "75", "1829a". Lookups should normalise (strip leading zeros) before match. */
  ziffer: string;
  /** Service description (Leistungslegende), inline notes stripped into `notes`. */
  description: string;
  /** Point value (Punktzahl). null for GOT (direct euro amounts) and for
   *  point-less GOÄ/GOZ entries whose fee is derived rather than fixed —
   *  percentage Zuschläge (e.g. GOÄ 5298, "25 v.H. des einfachen Gebührensatzes
   *  der betreffenden Leistung") and GOZ Teilleistungen (a fraction of a base
   *  position). Those entries carry `baseAmount: 0`. */
  points: number | null;
  /** 1.0× amount in EUR: points × pointValueCents/100 (GOÄ/GOZ) or the printed
   *  euro amount (GOT). The legacy "Gebühr in DM" column is ignored. 0 for
   *  point-less derived-fee entries (see `points`). */
  baseAmount: number;
  /** §5 multiplier category → Steigerungsfaktor limits. */
  category: FeeCategory;
  /**
   * Tariff benefit area this number falls into — the bridge to a tariff's
   * `included_benefits` (§3.2): the Erstattungs-Engine groups positions by it to
   * pick the matching reimbursement block. Derived at build time from the
   * schedule + Gebührenverzeichnis section (GOZ number ranges map to
   * zahnbehandlung / zahnersatz / kieferorthopaedie; all GOÄ → ambulant; GOT →
   * sonstiges). It is the *schedule-derivable default*; the ambulant↔stationär
   * distinction and non-GOÄ/GOZ areas (heilmittel/hilfsmittel) depend on the
   * invoice context and are resolved by the caller, not by the table. Always
   * emitted by the build (a schedule-derivable default), matching the
   * `fee-schedule/v1` JSON schema where it is a required field.
   */
  benefitCategory: BenefitCategory;
  /** Steigerungsfaktor threshold to flag against (Regelhöchstsatz for the
   *  category, or an entry-specific override where the law sets one). */
  maxMultiplier: number;
  /** True for surcharge positions (Zuschläge); usually billed at a fixed factor. */
  isSurcharge?: boolean;
  section?: FeeSection;
  /** Free-text legal notes that could not be modelled as a {@link Constraint}. */
  notes?: string[];
  /** Structured, machine-checkable dependencies attached to this number. */
  constraints?: Constraint[];
}

/**
 * A rule that spans a *set* of numbers rather than belonging to one entry —
 * e.g. a `mutualExclusion` clique ("Nummern 271 bis 276 nicht nebeneinander",
 * i.e. every member excludes every other) or a `maxAmount` Höchstwert capping a
 * group per period.
 *
 * Why this stays a group instead of being expanded into per-entry `excludes`
 * pairs: it is one legal sentence with one `id` and one `sourceText`. Keeping
 * that bracket lets the checker report exactly this rule as "applied"
 * (e.g. "excl-271-276 → applied to 271, 274") rather than an anonymous pair set,
 * and keeps the rule maintained in one place. For conflict *detection* a
 * `mutualExclusion` normalises to the same symmetric incompatibility pairs as
 * `excludes`; only the display identity differs. See docs/data-format.md §5.2.1.
 */
export type ConstraintGroup =
  | {
      id: string;
      type: 'mutualExclusion';
      members: string[];
      sourceText: string;
    }
  | {
      id: string;
      type: 'maxAmount';
      members: string[];
      /** Cap in EUR (1.0× basis). */
      amount: number;
      scope?: ConstraintScope;
      /** The Ziffer that carries the Höchstwert in the source table, if any. */
      cappingZiffer?: string;
      sourceText: string;
    };

/** §5 Steigerungsfaktor limits for one {@link FeeCategory}. */
export interface MultiplierLimit {
  /** Regelhöchstsatz / Schwellenwert — above this a line is flagged. */
  regelhoechstsatz: number | null;
  /** Absolute Höchstsatz the law allows with justification. */
  hoechstsatz: number | null;
}

/** Provenance of a generated table — pinned so re-generation diffs are auditable. */
export interface FeeScheduleSource {
  /** Citable law name, e.g. "GOÄ 1982 (neugefasst 1996)". */
  law: string;
  /** Source file under data/input/, e.g. "data/input/goae/BJNR015220982.xml". */
  file: string;
  /** gesetze-im-internet document number. */
  doknr: string;
  /** "Stand" line from the source metadata (last amendment). */
  lawStatus: string;
  /** builddate attribute from the source XML. */
  buildDate: string;
}

/** A complete generated lookup table for one fee schedule. */
export interface FeeScheduleTable {
  /** Format identifier, currently "fee-schedule/v1". */
  schema: 'fee-schedule/v1';
  feeSchedule: FeeScheduleId;
  /** Edition of the schedule, e.g. "1996-neugefasst". */
  version: string;
  source: FeeScheduleSource;
  /** Punktwert in cents (GOÄ 5.82873, GOZ 5.62421); null for GOT. */
  pointValueCents: number | null;
  currency: 'EUR';
  /** §5 limits per category (schedule-specific; GOT only fills `default`). */
  multiplierLimits: Record<FeeCategory, MultiplierLimit>;
  /** All billing numbers, keyed by `ziffer`. */
  entries: Record<string, FeeEntry>;
  /** Rules that span multiple numbers. */
  constraintGroups: ConstraintGroup[];
}
