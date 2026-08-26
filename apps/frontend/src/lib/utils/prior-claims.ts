// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * The two cross-invoice inputs of the Erstattungs-Engine (§8.4): how much of a
 * tariff cap the insured person's **other** invoices already used up, and the
 * patient age an age-bound cap is measured against.
 *
 * Without them every invoice is computed as if nothing had ever been reimbursed,
 * so a `jahr`/`lebenslang` limit or the Zahnstaffel only ever binds *within* a
 * single invoice and the resulting `eligible_amount` overstates what the tariff
 * pays (issue #370).
 *
 * ## Windows
 *
 * A cap's scope decides which invoices count as "prior":
 *
 * | Window           | Positions counted                                   |
 * | ---------------- | --------------------------------------------------- |
 * | `jahr`           | `treatment_date` in the reference Leistungsjahr      |
 * | `lebenslang`     | the whole history                                    |
 * | `annual_staffel` | `treatment_date` on/after the coverage start          |
 *
 * ## Which amount counts
 *
 * Per position, the realised `refund_amount` once the insurer has reimbursed
 * (`submission = erstattet`), otherwise the engine's own `eligible_amount`
 * estimate — the same "actual beats estimate" rule the Günstigerprüfung uses in
 * `aggregateByYear`. Unreviewed invoices (`review = neu`) are skipped: their
 * positions are not confirmed yet and must not consume someone else's cap.
 *
 * Pure and deterministic — the reference year, the coverage start and the age
 * reference date are all injected.
 */

import { differenceInYears, isBefore } from 'date-fns';
import {
  roundCents,
  toCalendarDate,
  type BenefitCategory,
  type DateInput,
  type GoaeCategory,
  type InvoiceStatus,
  type ProviderType,
} from '@selbstbehalt/shared';

import { type AuslagenDerivationPosition } from './auslagen-benefit-category';
import { resolveBenefitCategory } from './benefit-category';
import type { PriorClaims, PriorClaimWindow } from './erstattungs-engine';

/** What a stored position must expose to be counted towards a cap. */
export interface PriorClaimsPosition {
  goae_category?: GoaeCategory | null;
  benefit_category?: BenefitCategory | null;
  /** Leistungsdatum (ISO YYYY-MM-DD) — decides the `jahr` and `annual_staffel` windows. */
  treatment_date: string;
  charged_amount: number;
  eligible_amount?: number | null;
  refund_amount?: number | null;
}

/** What a stored invoice must expose to contribute prior claims. */
export interface PriorClaimsInvoice {
  id: string;
  /** Drives the whole-invoice fallback of {@link resolveBenefitCategory} for legacy rows. */
  provider_type?: ProviderType | null;
  /** Only the review and submission tracks matter here. */
  status: Pick<InvoiceStatus, 'review' | 'submission'>;
  positions: PriorClaimsPosition[];
}

/** Inputs for {@link aggregatePriorClaims}. */
export interface PriorClaimsInput {
  /**
   * All invoices of the insured person — including the one being computed, which
   * is removed via {@link excludeInvoiceId} so it never consumes its own cap.
   */
  invoices: PriorClaimsInvoice[];
  /** Id of the invoice being computed; `null`/absent while capturing a new one. */
  excludeInvoiceId?: string | null;
  /** Reference Leistungsjahr for the `jahr` window — see {@link referenceLeistungsjahr}. */
  year: number;
  /** Start of the person's cover (`insured_persons.start_date`) — opens the `annual_staffel` window. */
  coverageStart: DateInput;
}

/**
 * Aggregate the person's other invoices into the per-window, per-category volume
 * the Erstattungs-Engine subtracts from a cap.
 */
export function aggregatePriorClaims(input: PriorClaimsInput): PriorClaims {
  const coverageStart = toCalendarDate(input.coverageStart);
  const sums: Record<PriorClaimWindow, Partial<Record<BenefitCategory, number>>> = {
    jahr: {},
    lebenslang: {},
    annual_staffel: {},
  };

  for (const invoice of input.invoices) {
    if (invoice.id === input.excludeInvoiceId) continue;
    if (invoice.status.review === 'neu') continue;

    // Resolve categories exactly as InvoiceForm did when it computed the stored
    // amounts — including the Auslagen honorar dominance for legacy rows without a
    // persisted benefit_category — so prior volume lands in the same bucket the cap
    // is measured in.
    const providerType = invoice.provider_type ?? 'sonstiges';
    const honorarPositions: AuslagenDerivationPosition[] = invoice.positions.map((pos) => ({
      goaeCategory: pos.goae_category ?? null,
      benefitCategory: pos.benefit_category ?? null,
      chargedAmount: pos.charged_amount,
    }));

    const reimbursed = invoice.status.submission === 'erstattet';
    for (const pos of invoice.positions) {
      const amount = reimbursed ? (pos.refund_amount ?? 0) : (pos.eligible_amount ?? 0);
      if (amount === 0) continue;
      const category = resolveBenefitCategory(pos, honorarPositions, providerType);
      const treatment = toCalendarDate(pos.treatment_date);

      add(sums.lebenslang, category, amount);
      if (treatment.getFullYear() === input.year) add(sums.jahr, category, amount);
      if (!isBefore(treatment, coverageStart)) add(sums.annual_staffel, category, amount);
    }
  }

  for (const window of Object.keys(sums) as PriorClaimWindow[]) {
    for (const category of Object.keys(sums[window]) as BenefitCategory[]) {
      sums[window][category] = roundCents(sums[window][category]!);
    }
  }
  return sums;
}

function add(
  target: Partial<Record<BenefitCategory, number>>,
  category: BenefitCategory,
  amount: number,
): void {
  target[category] = (target[category] ?? 0) + amount;
}

/**
 * The Leistungsjahr a `jahr`-scoped cap is measured in for one invoice.
 *
 * The engine caps per category over the whole invoice, so it needs a single
 * reference year even though positions carry their own `treatment_date`. Take the
 * year that carries the largest share of the billed amount (ties → the earlier
 * year), which is the invoice's own Leistungsjahr for everything but a rare
 * year-straddling invoice; with no dated position at all, fall back to the
 * invoice date.
 *
 * A year-straddling invoice is therefore measured against one year's limit only —
 * the known limitation tracked in issue #391 (architecture §11.2), which needs the
 * engine to cap per category *and* year rather than per category alone.
 */
export function referenceLeistungsjahr(
  positions: Array<{ treatment_date?: string | null; charged_amount: number }>,
  invoiceDate: DateInput,
): number {
  const byYear = new Map<number, number>();
  for (const pos of positions) {
    if (!pos.treatment_date) continue;
    const year = toCalendarDate(pos.treatment_date).getFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + pos.charged_amount);
  }
  let best: number | null = null;
  let bestAmount = -1;
  for (const [year, amount] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    if (amount > bestAmount) {
      best = year;
      bestAmount = amount;
    }
  }
  return best ?? toCalendarDate(invoiceDate).getFullYear();
}

/**
 * Patient age in whole years at `asOf`, for the engine's age-bound `limits`.
 * `persons.birth_date` is nullable — an unknown birth date yields `undefined`,
 * which is how the engine keeps skipping age-bound limits with a note.
 */
export function patientAgeAt(
  birthDate: string | null | undefined,
  asOf: DateInput,
): number | undefined {
  if (!birthDate) return undefined;
  const age = differenceInYears(toCalendarDate(asOf), toCalendarDate(birthDate));
  return age >= 0 ? age : undefined;
}
