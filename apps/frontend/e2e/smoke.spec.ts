// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

test('dashboard renders and the primary navigation works', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'selbstbehalt' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Rechnungen' }).first().click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rechnungen' })).toBeVisible();
});
