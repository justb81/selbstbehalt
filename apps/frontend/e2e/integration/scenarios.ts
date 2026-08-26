// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Named seed scenarios for the integration profile (issue #378).
//
// Each scenario is a *precondition*: it builds a complete Person → Vertrag →
// versicherte Person → Rechnung → Positionen chain through the **real** REST API,
// so the fixture itself already exercises the server-side Zod validation, the
// derived-amount aggregation (`eligible_amount`/`self_paid_amount`) and the
// append-only status-event log — none of which a `page.route()` mock can.
//
// Alongside the created rows each scenario returns the facts the UI must show for
// it (`dashboard`), so the data-driven specs assert against one hand-written
// expectation per scenario instead of recomputing them from the app's own code.

import type { InsuredPersonCreate, InvoicePositionInput } from '@selbstbehalt/shared';

import type { SeedApi } from './backend';

/**
 * The Leistungsjahr the dashboard and the Selbstbehalt radar describe. Scenarios
 * are pinned to it (rather than to fixed dates) so they keep describing "this
 * year" as the calendar rolls over.
 */
export const CURRENT_YEAR = new Date().getFullYear();

/** An ISO date inside the current Leistungsjahr. */
function thisYear(monthDay: string): string {
  return `${CURRENT_YEAR}-${monthDay}`;
}

/** An ISO date inside the previous Leistungsjahr. */
function lastYear(monthDay: string): string {
  return `${CURRENT_YEAR - 1}-${monthDay}`;
}

/** The four Ampel labels of `SelbstbehaltRadar` (`$lib/utils/selbstbehalt-radar`). */
export type AmpelLabel =
  'Unter Selbstbehalt' | 'SB erreicht' | 'Einreichen lohnt' | 'Staffel gerissen';

/** What the dashboard must show for a seeded scenario. */
export interface DashboardFacts {
  /** "Verträge" tile. */
  contracts: number;
  /** "Offene Rechnungen" tile — neither paid nor submitted. */
  openInvoices: number;
  /** "Ausstehende Einreichungen" tile — submitted but not yet reimbursed. */
  pendingSubmissions: number;
  /** "Jahr <CURRENT_YEAR>" tile. */
  yearInvoices: number;
  /** One entry per versicherte Person, keyed by the person name shown on the card. */
  personCards: { person: string; ampel: AmpelLabel }[];
  /**
   * Name on the card that must sort first (most actionable, issue #261). Only
   * set where the Ampel priorities actually differ.
   */
  firstCard?: string;
}

/** A three-tier BRE ladder: one, two or three claim-free years pay one premium each. */
function breLadder(streakStart: string): NonNullable<InsuredPersonCreate['bre_structure']> {
  return {
    type: 'staffel',
    levels: [
      { claim_free_years: 1, bre_years: 1, pct_of_premium: 100 },
      { claim_free_years: 2, bre_years: 2, pct_of_premium: 100 },
      { claim_free_years: 3, bre_years: 3, pct_of_premium: 100 },
    ],
    current_streak_start: streakStart,
  };
}

/** Tariff reimbursing the given benefit categories in full. */
function fullCover(
  ...categories: ('ambulant' | 'stationaer' | 'zahnbehandlung')[]
): NonNullable<InsuredPersonCreate['included_benefits']> {
  return {
    benefits: categories.map((category) => ({ category, tiers: [{ up_to: null, pct: 100 }] })),
  };
}

/** A rule-compliant GOÄ line (Steigerungsfaktor within the §5 limit). */
function goaePosition(over: {
  goae_number: string;
  description: string;
  base_amount: number;
  charged_amount: number;
  treatment_date: string;
}): InvoicePositionInput {
  return {
    goae_category: 'GOÄ',
    benefit_category: 'ambulant',
    multiplier: 2.3,
    eligible_amount: over.charged_amount,
    is_valid: true,
    ...over,
  };
}

/**
 * `leer` — nothing captured yet. The empty states of every page, and the baseline
 * every other scenario is measured against.
 */
async function seedLeer(): Promise<{ dashboard: DashboardFacts }> {
  return {
    dashboard: {
      contracts: 0,
      openInvoices: 0,
      pendingSubmissions: 0,
      yearInvoices: 0,
      personCards: [],
    },
  };
}

/**
 * `baseline` — one household member, one Vertrag, one geprüfte but still unpaid
 * invoice with a compliant and a flagged GOÄ position. The year's reimbursable
 * sum stays far below the Selbstbehalt, so submitting is inconsequential.
 */
async function seedBaseline(api: SeedApi) {
  const person = await api.createPerson({ name: 'Max Mustermann', birth_date: '1985-06-15' });
  const contract = await api.createContract({
    policyholder_id: person.id,
    insurer_name: 'DKV',
    contract_number: 'KV-1001',
    type: 'vollversicherung',
    start_date: `${CURRENT_YEAR - 3}-01-01`,
  });
  const insured = await api.createInsured(contract.id, {
    person_id: person.id,
    kvnr: 'A100000001',
    tariff_name: 'BasisKomfort',
    monthly_premium: 400,
    self_retention: 600,
    bre_structure: breLadder(`${CURRENT_YEAR - 1}-01-01`),
    included_benefits: fullCover('ambulant', 'stationaer'),
    start_date: `${CURRENT_YEAR - 3}-01-01`,
  });

  const invoice = await api.createInvoice({
    insured_person_id: insured.id,
    invoice_date: thisYear('01-15'),
    payment_due_date: thisYear('12-15'),
    invoice_number: 'R-1001',
    provider_name: 'Praxis Dr. Nowak',
    provider_type: 'arzt',
    total_amount: 27.03,
    positions: [
      goaePosition({
        goae_number: '0001',
        description: 'Beratung',
        base_amount: 4.66,
        charged_amount: 10.72,
        treatment_date: thisYear('01-15'),
      }),
      {
        goae_number: '0005',
        goae_category: 'GOÄ',
        benefit_category: 'ambulant',
        description: 'Symptombezogene Untersuchung',
        multiplier: 3.5,
        base_amount: 4.66,
        charged_amount: 16.31,
        treatment_date: thisYear('01-15'),
        // Over the §5 GOÄ limit for personal services — nothing reimbursable.
        eligible_amount: null,
        is_valid: false,
        flag_reason: 'Steigerungsfaktor 3,5 überschreitet die Regelgrenze 2,3 (§5 GOÄ)',
      },
    ],
  });
  await api.markReviewed(invoice.id, 'GOÄ-Prüfung abgeschlossen');

  const dashboard: DashboardFacts = {
    contracts: 1,
    openInvoices: 1,
    pendingSubmissions: 0,
    yearInvoices: 1,
    personCards: [{ person: 'Max Mustermann', ampel: 'Unter Selbstbehalt' }],
  };

  return { person, contract, insured, invoice, dashboard };
}

/**
 * `familie_zwei_vertraege` — three versicherte Personen across two Verträge, with
 * the three status tracks in different combinations (offen / bezahlt+eingereicht /
 * bezahlt). One member is far over the Einreich-Schwelle and must therefore sort
 * to the top of the dashboard's person cards (issue #261).
 */
async function seedFamilieZweiVertraege(api: SeedApi) {
  const erika = await api.createPerson({ name: 'Erika Mustermann', birth_date: '1985-03-12' });
  const lena = await api.createPerson({ name: 'Lena Mustermann', birth_date: '2015-09-04' });
  const jonas = await api.createPerson({ name: 'Jonas Mustermann', birth_date: '1982-11-30' });

  const familienvertrag = await api.createContract({
    policyholder_id: erika.id,
    insurer_name: 'DKV',
    contract_number: 'KV-2001',
    type: 'vollversicherung',
    start_date: `${CURRENT_YEAR - 4}-01-01`,
  });
  const partnervertrag = await api.createContract({
    policyholder_id: jonas.id,
    insurer_name: 'Allianz',
    contract_number: 'KV-2002',
    type: 'vollversicherung',
    start_date: `${CURRENT_YEAR - 2}-01-01`,
  });

  const insuredErika = await api.createInsured(familienvertrag.id, {
    person_id: erika.id,
    kvnr: 'A200000001',
    tariff_name: 'FamilieKomfort',
    monthly_premium: 452.3,
    self_retention: 600,
    bre_structure: breLadder(`${CURRENT_YEAR - 1}-01-01`),
    included_benefits: fullCover('ambulant', 'stationaer', 'zahnbehandlung'),
  });
  const insuredLena = await api.createInsured(familienvertrag.id, {
    person_id: lena.id,
    kvnr: 'A200000002',
    tariff_name: 'KinderSelect',
    monthly_premium: 168.5,
    self_retention: 200,
    bre_structure: breLadder(`${CURRENT_YEAR - 1}-01-01`),
    included_benefits: fullCover('ambulant'),
  });
  // Low premium ⇒ a small BRE ladder ⇒ a low Einreich-Schwelle, which the
  // invoice below clears by a wide margin.
  const insuredJonas = await api.createInsured(partnervertrag.id, {
    person_id: jonas.id,
    kvnr: 'A200000003',
    tariff_name: 'PartnerBasis',
    monthly_premium: 100,
    self_retention: 300,
    bre_structure: breLadder(`${CURRENT_YEAR - 1}-01-01`),
    included_benefits: fullCover('ambulant', 'stationaer'),
  });

  // Erika: nur geprüft → zählt als offene Rechnung.
  const invoiceErika = await api.createInvoice({
    insured_person_id: insuredErika.id,
    invoice_date: thisYear('02-10'),
    invoice_number: 'R-2001',
    provider_name: 'Praxis Dr. Müller',
    provider_type: 'arzt',
    total_amount: 82.5,
    positions: [
      goaePosition({
        goae_number: '0003',
        description: 'Eingehende Beratung',
        base_amount: 35.87,
        charged_amount: 82.5,
        treatment_date: thisYear('02-10'),
      }),
    ],
  });
  await api.markReviewed(invoiceErika.id);

  // Lena: bezahlt und eingereicht, aber noch nicht erstattet → ausstehende Einreichung.
  const invoiceLena = await api.createInvoice({
    insured_person_id: insuredLena.id,
    invoice_date: thisYear('03-05'),
    invoice_number: 'R-2002',
    provider_name: 'Kinderarztpraxis Sonne',
    provider_type: 'arzt',
    total_amount: 45.9,
    positions: [
      goaePosition({
        goae_number: '0001',
        description: 'Beratung',
        base_amount: 19.96,
        charged_amount: 45.9,
        treatment_date: thisYear('03-05'),
      }),
    ],
  });
  await api.markReviewed(invoiceLena.id);
  await api.markPaid(invoiceLena.id, thisYear('03-12'));
  await api.submit(invoiceLena.id, { submitted_via: 'app', expected_refund: 45.9 });

  // Jonas: bezahlt, nicht eingereicht — und weit über der Einreich-Schwelle.
  const invoiceJonas = await api.createInvoice({
    insured_person_id: insuredJonas.id,
    invoice_date: thisYear('04-02'),
    invoice_number: 'R-2003',
    provider_name: 'Klinik am Park',
    provider_type: 'krankenhaus',
    total_amount: 4000,
    positions: [
      goaePosition({
        goae_number: '0034',
        description: 'Erörterung und Behandlungsplan',
        base_amount: 1739.13,
        charged_amount: 4000,
        treatment_date: thisYear('04-02'),
      }),
    ],
  });
  await api.markReviewed(invoiceJonas.id);
  await api.markPaid(invoiceJonas.id, thisYear('04-10'));

  const dashboard: DashboardFacts = {
    contracts: 2,
    openInvoices: 1,
    pendingSubmissions: 1,
    yearInvoices: 3,
    personCards: [
      { person: 'Jonas Mustermann', ampel: 'Einreichen lohnt' },
      { person: 'Erika Mustermann', ampel: 'Unter Selbstbehalt' },
      { person: 'Lena Mustermann', ampel: 'Unter Selbstbehalt' },
    ],
    firstCard: 'Jonas Mustermann',
  };

  return {
    persons: { erika, lena, jonas },
    contracts: { familienvertrag, partnervertrag },
    insured: { erika: insuredErika, lena: insuredLena, jonas: insuredJonas },
    invoices: { erika: invoiceErika, lena: invoiceLena, jonas: invoiceJonas },
    dashboard,
  };
}

/**
 * `sb_erreicht` — the year's reimbursable sum has passed the Selbstbehalt but not
 * the Einreich-Schwelle `S + NPV(ΔBRE)`: a high premium makes the BRE at stake
 * outweigh the extra reimbursement, so self-paying still wins.
 */
async function seedSbErreicht(api: SeedApi) {
  const person = await api.createPerson({ name: 'Sofia Reiter', birth_date: '1978-04-22' });
  const contract = await api.createContract({
    policyholder_id: person.id,
    insurer_name: 'Debeka',
    contract_number: 'KV-3001',
    type: 'vollversicherung',
    start_date: `${CURRENT_YEAR - 5}-01-01`,
  });
  // S = 200 against a 500 €/month premium: the three-tier ladder is worth several
  // hundred Euro, so the threshold sits far above the 300 € seeded below.
  const insured = await api.createInsured(contract.id, {
    person_id: person.id,
    kvnr: 'A300000001',
    tariff_name: 'PremiumSchwelle',
    monthly_premium: 500,
    self_retention: 200,
    bre_structure: breLadder(`${CURRENT_YEAR - 1}-01-01`),
    included_benefits: fullCover('ambulant'),
  });

  const invoice = await api.createInvoice({
    insured_person_id: insured.id,
    invoice_date: thisYear('05-20'),
    invoice_number: 'R-3001',
    provider_name: 'Praxis Dr. Hoffmann',
    provider_type: 'arzt',
    total_amount: 300,
    positions: [
      goaePosition({
        goae_number: '0007',
        description: 'Vollständige körperliche Untersuchung',
        base_amount: 130.43,
        charged_amount: 300,
        treatment_date: thisYear('05-20'),
      }),
    ],
  });
  await api.markReviewed(invoice.id);

  const dashboard: DashboardFacts = {
    contracts: 1,
    openInvoices: 1,
    pendingSubmissions: 0,
    yearInvoices: 1,
    personCards: [{ person: 'Sofia Reiter', ampel: 'SB erreicht' }],
  };

  return { person, contract, insured, invoice, dashboard };
}

/**
 * `ueber_schwelle` — the year's reimbursable sum across several invoices clears
 * `S + NPV(ΔBRE)`, so the Günstigerprüfung says einreichen.
 */
async function seedUeberSchwelle(api: SeedApi) {
  const person = await api.createPerson({ name: 'Tobias Frank', birth_date: '1969-08-08' });
  const contract = await api.createContract({
    policyholder_id: person.id,
    insurer_name: 'Barmenia',
    contract_number: 'KV-4001',
    type: 'vollversicherung',
    start_date: `${CURRENT_YEAR - 6}-01-01`,
  });
  const insured = await api.createInsured(contract.id, {
    person_id: person.id,
    kvnr: 'A400000001',
    tariff_name: 'SchwelleGerissen',
    monthly_premium: 120,
    self_retention: 500,
    bre_structure: breLadder(`${CURRENT_YEAR - 1}-01-01`),
    included_benefits: fullCover('ambulant', 'stationaer'),
  });

  const first = await api.createInvoice({
    insured_person_id: insured.id,
    invoice_date: thisYear('02-01'),
    invoice_number: 'R-4001',
    provider_name: 'Radiologie Zentrum',
    provider_type: 'arzt',
    total_amount: 1800,
    positions: [
      goaePosition({
        goae_number: '5370',
        description: 'Computertomographie',
        base_amount: 782.61,
        charged_amount: 1800,
        treatment_date: thisYear('02-01'),
      }),
    ],
  });
  const second = await api.createInvoice({
    insured_person_id: insured.id,
    invoice_date: thisYear('06-11'),
    invoice_number: 'R-4002',
    provider_name: 'Klinik Nordlicht',
    provider_type: 'krankenhaus',
    total_amount: 3400,
    positions: [
      goaePosition({
        goae_number: '2800',
        description: 'Operativer Eingriff',
        base_amount: 1478.26,
        charged_amount: 3400,
        treatment_date: thisYear('06-11'),
      }),
    ],
  });
  await api.markReviewed(first.id);
  await api.markReviewed(second.id);

  const dashboard: DashboardFacts = {
    contracts: 1,
    openInvoices: 2,
    pendingSubmissions: 0,
    yearInvoices: 2,
    personCards: [{ person: 'Tobias Frank', ampel: 'Einreichen lohnt' }],
  };

  return {
    person,
    contract,
    insured,
    invoices: [first, second],
    /** Σ eligible for the current Leistungsjahr — the radar's `R_Y`. */
    R_Y: 5200,
    dashboard,
  };
}

/**
 * `staffel_zwei_leistungsjahre` — a Zahnersatz tariff with a Schwellen-Staffel
 * (80 % up to 500 €, 50 % above) and a GOZ invoice whose positions fall into two
 * Leistungsjahre; already submitted and reimbursed. Covers the erstattet track,
 * the per-Leistungsjahr roll-up (`/api/stats/positions/:id`, #239) and the
 * "Staffel gerissen" Ampel — the realised reimbursement exceeds the Selbstbehalt.
 */
async function seedStaffelZweiLeistungsjahre(api: SeedApi) {
  const person = await api.createPerson({ name: 'Miriam Kraus', birth_date: '1974-02-19' });
  const contract = await api.createContract({
    policyholder_id: person.id,
    insurer_name: 'Signal Iduna',
    contract_number: 'KV-5001',
    type: 'vollversicherung',
    start_date: `${CURRENT_YEAR - 8}-01-01`,
  });
  const insured = await api.createInsured(contract.id, {
    person_id: person.id,
    kvnr: 'A500000001',
    tariff_name: 'ZahnStaffel',
    monthly_premium: 380,
    self_retention: 400,
    bre_structure: breLadder(`${CURRENT_YEAR - 2}-01-01`),
    included_benefits: {
      benefits: [
        { category: 'ambulant', tiers: [{ up_to: null, pct: 100 }] },
        // Schwellen-Staffel: 80 % bis 500 €, darüber 50 %.
        {
          category: 'zahnersatz',
          waiting_period_months: 8,
          tiers: [
            { up_to: 500, pct: 80 },
            { up_to: null, pct: 50 },
          ],
        },
      ],
    },
  });

  const invoice = await api.createInvoice({
    insured_person_id: insured.id,
    invoice_date: thisYear('01-20'),
    invoice_number: 'R-5001',
    provider_name: 'Zahnarztpraxis Dr. Weber',
    provider_type: 'zahnarzt',
    total_amount: 2000,
    positions: [
      {
        goae_number: '0040',
        goae_category: 'GOZ',
        benefit_category: 'zahnersatz',
        description: 'Befundaufnahme und Beratung',
        multiplier: 2.3,
        base_amount: 173.91,
        charged_amount: 400,
        // Leistungsjahr CURRENT_YEAR − 1.
        treatment_date: lastYear('11-08'),
        eligible_amount: 320,
        is_valid: true,
      },
      {
        goae_number: '2060',
        goae_category: 'GOZ',
        benefit_category: 'zahnersatz',
        description: 'Versorgung eines Zahnes mit einer Vollkrone',
        multiplier: 2.3,
        base_amount: 695.65,
        charged_amount: 1600,
        // Leistungsjahr CURRENT_YEAR.
        treatment_date: thisYear('01-20'),
        eligible_amount: 1000,
        is_valid: true,
      },
    ],
  });
  await api.markReviewed(invoice.id);
  await api.markPaid(invoice.id, thisYear('01-25'));
  await api.submit(invoice.id, { submitted_via: 'post', expected_refund: 1320 });

  // Refunds are recorded per position id, so read the persisted lines back rather
  // than assuming the server returns them in insertion order.
  const persisted = await api.getInvoice(invoice.id);
  const positionId = (goaeNumber: string): string => {
    const match = persisted.positions.find((p) => p.goae_number === goaeNumber);
    if (!match) throw new Error(`Seeded position ${goaeNumber} missing from the invoice`);
    return match.id;
  };
  await api.recordRefund(
    invoice.id,
    [
      { id: positionId('0040'), refund_amount: 320 },
      { id: positionId('2060'), refund_amount: 1000 },
    ],
    thisYear('02-14'),
  );

  const dashboard: DashboardFacts = {
    contracts: 1,
    openInvoices: 0,
    pendingSubmissions: 0,
    yearInvoices: 1,
    personCards: [{ person: 'Miriam Kraus', ampel: 'Staffel gerissen' }],
  };

  return {
    person,
    contract,
    insured,
    invoice: await api.getInvoice(invoice.id),
    /** Σ charged − Σ refund, recomputed server-side when the refund was recorded. */
    selfPaidAmount: 680,
    dashboard,
  };
}

export const scenarios = {
  leer: seedLeer,
  baseline: seedBaseline,
  familie_zwei_vertraege: seedFamilieZweiVertraege,
  sb_erreicht: seedSbErreicht,
  ueber_schwelle: seedUeberSchwelle,
  staffel_zwei_leistungsjahre: seedStaffelZweiLeistungsjahre,
} as const;

export type ScenarioName = keyof typeof scenarios;
