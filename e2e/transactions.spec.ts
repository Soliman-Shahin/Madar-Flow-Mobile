import { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiGet, login } from './support';

/** Open the transactions tab and wait until the list has finished loading. */
async function openTransactions(page: Page) {
  await page.goto('/transactions/list');
  await expect(page.getByRole('button', { name: /QA sample 1 /i })).toBeVisible({ timeout: 20_000 });
}

/** Open the create sheet from the tab bar (no navigation, so it also works offline). */
async function openCreateSheet(page: Page) {
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Create Transaction' })).toBeVisible();
  // Ionic slots the sheet content outside the dialog element, so query the page, not the dialog.
  return page;
}

async function fillAndCreate(page: Page, description: string, amount: string) {
  const dialog = await openCreateSheet(page);
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  await dialog.locator('input[type="number"]').fill(amount);
  await dialog.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Food' }).click();
  await dialog.getByRole('textbox', { name: 'Description' }).fill(description);
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
}

test('adding a transaction shows it immediately and stores it on the server', async ({ page, request }) => {
  const description = `E2E expense ${Date.now()}`;
  await login(page);
  await openTransactions(page);
  await fillAndCreate(page, description, '42.5');
  await expect(page.getByRole('button', { name: new RegExp(description) })).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () => (await apiGet<{ description: string; amount: number }[]>(request, '/expenses')).find((e) => e.description === description)?.amount, { timeout: 30_000 })
    .toBe(42.5);
});

test('a transaction created offline is queued and synced when the connection returns', async ({ page, context, request }) => {
  const description = `E2E offline ${Date.now()}`;
  await login(page);
  await openTransactions(page);

  // Warm the lazily loaded sheet while online: the dev server is localhost, so going offline
  // would otherwise also block its JS chunks (a packaged/PWA build has them locally).
  await openCreateSheet(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Create Transaction' })).toBeHidden();

  await context.setOffline(true);
  await fillAndCreate(page, description, '7');
  await expect(page.getByRole('button', { name: new RegExp(description) })).toBeVisible({ timeout: 20_000 });

  // While offline the server must not know about it yet (the API client uses its own, online, context).
  const before = await apiGet<{ description: string }[]>(request, '/expenses');
  expect(before.some((e) => e.description === description)).toBe(false);

  await context.setOffline(false);
  await expect
    .poll(async () => (await apiGet<{ description: string }[]>(request, '/expenses')).some((e) => e.description === description), { timeout: 60_000, intervals: [2000] })
    .toBe(true);

  // No duplicate after the sync.
  const after = await apiGet<{ description: string }[]>(request, '/expenses');
  expect(after.filter((e) => e.description === description)).toHaveLength(1);
});

test('amount is required before a transaction can be created', async ({ page }) => {
  await login(page);
  await openTransactions(page);
  const dialog = await openCreateSheet(page);
  await dialog.getByRole('group', { name: 'Category' }).getByRole('button', { name: 'Food' }).click();
  await dialog.getByRole('textbox', { name: 'Description' }).fill('no amount');
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
});
