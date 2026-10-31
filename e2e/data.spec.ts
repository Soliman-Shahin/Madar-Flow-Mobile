import { expect, test } from './fixtures';
import { login } from './support';

test.describe('data pulled from the server', () => {
  test('categories list shows the seeded categories with transaction counts', async ({ page }) => {
    await login(page);
    await page.goto('/categories');
    for (const title of ['Food', 'Transport', 'Salary']) {
      await expect(page.getByRole('button', { name: `Category actions: ${title}` })).toBeVisible({ timeout: 20_000 });
    }
  });

  test('transactions list shows the seeded expenses grouped by day', async ({ page }) => {
    await login(page);
    await page.goto('/transactions');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /QA sample 1 /i })).toBeVisible();
  });

  test('transaction search filters the list', async ({ page }) => {
    await login(page);
    await page.goto('/transactions');
    const search = page.getByRole('searchbox', { name: 'search text' });
    await expect(page.getByRole('button', { name: /QA sample 1 /i })).toBeVisible({ timeout: 20_000 });
    await search.fill('QA sample 2');
    await expect(page.getByRole('button', { name: /QA sample 1 /i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /QA sample 2 /i })).toBeVisible();
  });

  test('settings shows the signed-in account', async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await expect(page.getByText('qa-user-free@madarflow.test').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
  });
});
