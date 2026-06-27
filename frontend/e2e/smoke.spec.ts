// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

test('home page renders the application heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'selbstbehalt' })).toBeVisible();
});
