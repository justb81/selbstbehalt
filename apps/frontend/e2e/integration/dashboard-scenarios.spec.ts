// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Data-driven dashboard checks over the named seed scenarios (issue #378): the
// same spec runs against every precondition, so the fachliche Variantenbreite —
// several Personen/Verträge, tariffs with and without a meaningful Selbstbehalt,
// all combinations of the three status tracks, and every Günstigerprüfungs-Ampel —
// is covered end-to-end instead of only in unit tests.

import type { Locator, Page } from '@playwright/test';

import { expect, test } from './backend';
import { CURRENT_YEAR, scenarios, type ScenarioName } from './scenarios';

/** The value of one dashboard KPI tile, addressed by its description. */
function kpi(page: Page, description: string): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ hasText: description })
    .locator('[data-slot="card-content"] p')
    .first();
}

/** The per-person Selbstbehalt/BRE card, addressed by the person's name. */
function personCard(page: Page, person: string): Locator {
  return page.locator('a[href^="/insured/"]').filter({ hasText: person });
}

const CASES: ScenarioName[] = [
  'leer',
  'baseline',
  'familie_zwei_vertraege',
  'sb_erreicht',
  'ueber_schwelle',
  'staffel_zwei_leistungsjahre',
];

for (const name of CASES) {
  test.describe(`Szenario "${name}"`, () => {
    test('Dashboard zeigt die Kennzahlen und Ampeln des Szenarios', async ({ page, seed }) => {
      const { dashboard } = await scenarios[name](seed);

      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

      await expect(kpi(page, 'Offene Rechnungen')).toHaveText(String(dashboard.openInvoices));
      await expect(kpi(page, 'Ausstehende Einreichungen')).toHaveText(
        String(dashboard.pendingSubmissions),
      );
      await expect(kpi(page, `Jahr ${CURRENT_YEAR}`)).toHaveText(String(dashboard.yearInvoices));
      await expect(kpi(page, 'Verträge')).toHaveText(String(dashboard.contracts));

      for (const { person, ampel } of dashboard.personCards) {
        await expect(personCard(page, person)).toContainText(ampel);
      }
      await expect(page.locator('a[href^="/insured/"]')).toHaveCount(dashboard.personCards.length);

      // Most actionable person first (issue #261) — only asserted where the
      // scenario's Ampel priorities actually differ.
      if (dashboard.firstCard) {
        await expect(page.locator('a[href^="/insured/"]').first()).toContainText(
          dashboard.firstCard,
        );
      }
    });
  });
}

test.describe('Szenario "leer"', () => {
  test('Dashboard und Auswertung zeigen ihre Leerzustände', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Noch keine Verträge angelegt.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ersten Vertrag anlegen' })).toBeVisible();

    await page.goto('/stats');
    await expect(
      page.getByText(
        'Noch keine Rechnungen oder versicherten Personen für eine Auswertung vorhanden.',
      ),
    ).toBeVisible();
  });
});
