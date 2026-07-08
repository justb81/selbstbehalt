// SPDX-License-Identifier: Apache-2.0
/**
 * Selbstbehalt-Ausschöpfung & Günstigerprüfungs-Schwellen-Radar (issue #234).
 *
 * A forward-looking, live view for the **current** Leistungsjahr that turns the
 * retrospective Günstigerprüfung engine (`guenstiger-pruefung.ts`) into an everyday
 * traffic-light (Ampel): how far the year's cumulative reimbursable sum `R_Y` fills
 * the annual Selbstbehalt `S`, and how close it is to the submit threshold
 * `S + NPV(ΔBRE)`.
 *
 * Everything is derived from the **same** engine — no reimplemented decision rule
 * (design §5.2, acceptance criterion "gemeinsame Quelle, keine Doppelrechnung"):
 * - the Ampel state and `alreadyBroken` come from {@link calculateGCP};
 * - the threshold marker uses {@link calculateBRELadderNPV} for the **potential**
 *   NPV, so `S + NPV` has a fixed position even while the year is still under `S`
 *   (where `calculateGCP` reports NPV = 0, because submitting there is inconsequential).
 *
 * Pure and deterministic — inject `asOf` for reproducible tests.
 */

import {
  roundCents,
  toCalendarDate,
  type BREStructure,
  type DateInput,
} from '@selbstbehalt/shared';

import {
  calculateBRELadderNPV,
  calculateGCP,
  type GCP_Result,
} from '$lib/utils/guenstiger-pruefung';

/**
 * The four everyday states of the Ampel (design §5.2.1 / §5.2.3):
 * - `unter_sb` — R_Y ≤ S: submitting is inconsequential (no refund, streak safe).
 * - `sb_erreicht_unter_schwelle` — S < R_Y ≤ threshold: submitting now still costs
 *   more BRE than it returns; waiting/self-paying preserves the streak.
 * - `ueber_schwelle` — R_Y > threshold: submitting the whole year is worthwhile.
 * - `bereits_gebrochen` — realised reimbursements already exceed S: the streak for
 *   the year is irrevocably gone, so submit everything (no further BRE at stake).
 */
export type SBRadarState =
  'unter_sb' | 'sb_erreicht_unter_schwelle' | 'ueber_schwelle' | 'bereits_gebrochen';

/** Inputs for {@link computeSelbstbehaltRadar}. */
export interface SBRadarInput {
  /** The (current) Leistungsjahr the radar describes. */
  year: number;
  /** Cumulative relevant amount R_Y for the year (design §5.2.1; from the positions roll-up). */
  R_Y: number;
  /** Reimbursements already realised for the year (Σ `refund_amount`). */
  alreadyReimbursed: number;
  /** Annual deductible S in EUR (`insured_persons.self_retention`). */
  selbstbehalt: number;
  /** The insured person's BRE ladder, or `null` when none is configured. */
  breStructure: BREStructure | null;
  /** Monthly premium in EUR — the base of the projected refund. */
  monthlyPremium: number;
  /** Annual discount rate i (defaults to the engine default). */
  discountRate?: number;
  /** Probability p of remaining claim-free (defaults to the engine default). */
  claimFreeProbability?: number;
  /** BRE payout month 1–12 (defaults to the engine default, July). */
  payoutMonth?: number;
  /** Reference day; inject in tests for deterministic results. */
  asOf?: DateInput;
}

/** The computed radar for one insured person × current Leistungsjahr. */
export interface SBRadar {
  /** The Leistungsjahr described. */
  year: number;
  /** Cumulative relevant amount R_Y for the year. */
  R_Y: number;
  /** Annual deductible S. */
  selbstbehalt: number;
  /**
   * Potential NPV(ΔBRE) — the BRE loss submitting *would* incur once the year
   * crosses S. Drawn even below S (unlike the engine's `lostBREValue_NPV`, which is
   * 0 there). Zero when the streak is already broken or no BRE ladder is configured.
   */
  npvThreshold: number;
  /** Submit threshold `S + npvThreshold` — the second thermometer marker. */
  gcpThreshold: number;
  /** SB exhaustion `min(R_Y, S) / S`, clamped to [0, 1]; `1` when S ≤ 0. */
  sbExhaustion: number;
  /** Remaining amount until submitting becomes worthwhile: `max(0, gcpThreshold − R_Y)`. */
  restBisEinreichen: number;
  /** The Ampel state. */
  state: SBRadarState;
  /** Whether the streak for the year is already, irrevocably broken. */
  alreadyBroken: boolean;
  /**
   * The full engine verdict for the year (for linking / detail), or `null` when no
   * BRE ladder is configured — mirroring the `/insured/[id]` handling.
   */
  gcp: GCP_Result | null;
}

/** The Leistungsjahr that `asOf` falls into (calendar year, timezone-safe). */
export function currentLeistungsjahr(asOf: DateInput = new Date()): number {
  return toCalendarDate(asOf).getFullYear();
}

/**
 * Compute the Selbstbehalt/Günstigerprüfung radar for one insured person and one
 * (current) Leistungsjahr. See {@link SBRadar} for the returned figures.
 */
export function computeSelbstbehaltRadar(input: SBRadarInput): SBRadar {
  const {
    year,
    R_Y,
    alreadyReimbursed,
    selbstbehalt,
    breStructure,
    monthlyPremium,
    discountRate,
    claimFreeProbability,
    payoutMonth,
    asOf,
  } = input;

  // The streak is irrevocably gone only once realised reimbursements exceed S
  // (design §5.2.1, point 2). Same rule the engine applies.
  const alreadyBroken = alreadyReimbursed > selbstbehalt;

  // Full verdict via the shared engine (null when no ladder — same as /insured/[id]).
  const gcp = breStructure
    ? calculateGCP({
        year,
        erstattungsBetrag: R_Y,
        alreadyReimbursed,
        selbstbehalt,
        breStructure,
        monthlyPremium,
        discountRate,
        claimFreeProbability,
        payoutMonth,
        asOf,
      })
    : null;

  // Potential NPV(ΔBRE) for the threshold marker — full, even below S. Zero when the
  // streak is already broken (no further BRE to lose) or no ladder is configured.
  const npvThreshold =
    breStructure && !alreadyBroken
      ? calculateBRELadderNPV({
          year,
          breStructure,
          monthlyPremium,
          discountRate,
          claimFreeProbability,
          payoutMonth,
          asOf,
        }).npv
      : 0;

  const gcpThreshold = roundCents(selbstbehalt + npvThreshold);
  const restBisEinreichen = roundCents(Math.max(0, gcpThreshold - R_Y));
  const sbExhaustion = selbstbehalt > 0 ? Math.min(1, Math.max(0, R_Y / selbstbehalt)) : 1;

  const state: SBRadarState = alreadyBroken
    ? 'bereits_gebrochen'
    : R_Y > gcpThreshold
      ? 'ueber_schwelle'
      : R_Y > selbstbehalt
        ? 'sb_erreicht_unter_schwelle'
        : 'unter_sb';

  return {
    year,
    R_Y,
    selbstbehalt,
    npvThreshold,
    gcpThreshold,
    sbExhaustion,
    restBisEinreichen,
    state,
    alreadyBroken,
    gcp,
  };
}
