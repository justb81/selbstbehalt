// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
/**
 * Regression cover for issue #381: with the backend unreachable but the browser
 * still reporting `navigator.onLine === true`, the app used to look healthy —
 * a global hint was missing entirely, values that failed to load rendered as
 * `0`, and the only error sat far down the page inside a card.
 *
 * Playwright matches route handlers last-registered-first, so every `abort`
 * below must be registered *after* `mockBackend`.
 */
import { expect, test } from '@playwright/test';

import { abortApi, mockBackend } from './fixtures';

test.describe('Backend nicht erreichbar', () => {
  test('/stats meldet den Ausfall global und erfindet keine Nullen', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await abortApi(page, '/api/stats/');

    await page.goto('/stats');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();

    // 1. Ein globaler Hinweis, nicht nur ein ErrorState am Seitenende.
    await expect(page.getByText('Server nicht erreichbar')).toBeVisible();

    // 2. Kennzahlen ohne Daten zeigen „nicht verfügbar", niemals 0.
    const kpis = page.getByRole('region', { name: 'Jahres-Kennzahlen' });
    await expect(kpis).toContainText('—');
    await expect(kpis).not.toContainText('0,00');

    // 3. Ein sichtbarer Teil-Fehler steht über den Kacheln.
    await expect(
      page.getByText('Jahreswerte: 1 von 1 konnten nicht geladen werden.'),
    ).toBeVisible();
  });

  test('/stats zeigt keine grüne Ampel aus fehlenden Roll-up-Daten', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await abortApi(page, '/api/stats/positions/');

    await page.goto('/stats');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();

    await expect(
      page.getByText('Selbstbehalt-Werte: 1 von 1 konnten nicht geladen werden.'),
    ).toBeVisible();
    // Ohne Roll-up darf gar keine Ampel gerendert werden — auch keine grüne.
    await expect(page.getByText('Selbstbehalt-Ausschöpfung')).toHaveCount(0);
  });

  test('das Dashboard meldet den Ausfall statt eines leeren Zustands', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await abortApi(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // Globaler Hinweis (Toast) …
    await expect(page.getByText('Server nicht erreichbar')).toBeVisible();
    // … und auf der Seite selbst statt einer Wand aus Nullen.
    await expect(page.getByText('Daten konnten nicht geladen werden')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Erneut versuchen' }).first()).toBeVisible();
    await expect(page.getByText('Offene Rechnungen')).toHaveCount(0);
    // Kein „alles in Ordnung, nur nichts da"-Eindruck.
    await expect(page.getByText('Noch keine Rechnungen erfasst')).toHaveCount(0);
  });

  test('ein offline-Gerät zeigt nur den Offline-Hinweis, nicht den Server-Hinweis', async ({
    page,
    context,
  }) => {
    await mockBackend(page, { populated: true });
    await abortApi(page, '/api/stats/');

    await page.goto('/stats');
    await expect(page.getByText('Server nicht erreichbar')).toBeVisible();

    // Geht zusätzlich das Gerät offline, ist das die speziellere Diagnose: der
    // bestehende Offline-Hinweis übernimmt, der Server-Hinweis verschwindet —
    // nie zwei widersprüchliche Meldungen nebeneinander.
    await context.setOffline(true);

    await expect(page.getByText('Offline – Änderungen werden gespeichert.')).toBeVisible();
    await expect(page.getByText('Server nicht erreichbar')).toHaveCount(0);
  });

  // Issue #396 — dasselbe Muster außerhalb von /stats. Das Prefix trifft
  // `GET /api/contracts/:id/insured`, aber nicht `GET /api/contracts`: die
  // Liste lädt, nur der Detail-Lookup fällt aus.
  test('/contracts erfindet keinen Versicherten-Zähler', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await abortApi(page, '/api/contracts/');

    await page.goto('/contracts');
    await expect(page.getByRole('heading', { level: 1, name: 'Verträge' })).toBeVisible();

    // Die Karte ist da (der Vertrag lädt), aber der Zähler ist unbekannt.
    await expect(page.getByText('AOK')).toBeVisible();
    await expect(page.getByText('0 versicherte Personen')).toHaveCount(0);
    await expect(page.getByText('Versicherte: —')).toBeVisible();
    await expect(
      page.getByText('Versicherten-Zähler: 1 von 1 konnten nicht geladen werden.'),
    ).toBeVisible();
  });

  test('/insured lässt keinen Vertrag verschwinden', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await abortApi(page, '/api/contracts/');

    await page.goto('/insured');
    await expect(page.getByRole('heading', { level: 1, name: 'Versicherte' })).toBeVisible();

    // Der Vertrag bleibt gelistet …
    await expect(page.getByText('AOK')).toBeVisible();
    await expect(
      page.getByText('Versicherte Personen konnten nicht geladen werden.'),
    ).toBeVisible();
    // … und die Seite behauptet nicht, es gäbe keine.
    await expect(page.getByText('Noch keine versicherten Personen vorhanden.')).toHaveCount(0);
  });

  test('/invoices behält das Archiv, wenn nur der Personen-Filter scheitert', async ({ page }) => {
    await mockBackend(page, { populated: true });
    await abortApi(page, '/api/contracts/');

    await page.goto('/invoices');
    await expect(page.getByRole('heading', { level: 1, name: 'Rechnungen' })).toBeVisible();

    // Die Rechnung ist geladen — nur das Filter-Dropdown ist unvollständig.
    await expect(page.getByText('Praxis Dr. med. Mustermann')).toBeVisible();
    await expect(page.getByText('Rechnungen konnten nicht geladen werden.')).toHaveCount(0);
  });
});
