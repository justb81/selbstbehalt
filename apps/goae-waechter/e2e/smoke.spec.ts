// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

test('the check screen renders with the privacy notice and scan entry point', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('GOÄ-Wächter', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Arztrechnung prüfen' })).toBeVisible();
  await expect(page.getByText('Ihr Bild verlässt nie dieses Gerät')).toBeVisible();
  await expect(page.getByText('Rechnung hierher ziehen oder auswählen')).toBeVisible();

  // No save button — the demo has nothing to persist (issue #166/#170).
  await expect(page.getByRole('button', { name: /speichern/i })).toHaveCount(0);
});
