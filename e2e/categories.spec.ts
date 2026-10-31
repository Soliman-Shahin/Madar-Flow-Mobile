import { expect, test } from './fixtures';
import { apiGet, login } from './support';

test('creating a category in the UI persists it on the server', async ({ page, request }) => {
  const title = `E2E cat ${Date.now()}`;
  await login(page);
  await page.goto('/categories/create');
  const create = page.getByRole('button', { name: 'Create' });
  await expect(create).toBeDisabled();
  await page.getByPlaceholder('Enter category title').fill(title);
  await page.getByRole('button', { name: 'Red' }).click();
  await page.getByRole('button', { name: 'cart-outline' }).click();
  await expect(create).toBeEnabled();
  await create.click();

  await expect(page).toHaveURL(/\/categories\/list/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: `Category actions: ${title}` })).toBeVisible();

  await expect
    .poll(async () => (await apiGet<{ data: { title: string }[] }>(request, '/categories/list')).data.map((c) => c.title), { timeout: 30_000 })
    .toContain(title);
});

test('category title is required', async ({ page }) => {
  await login(page);
  await page.goto('/categories/create');
  await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();
  await page.getByPlaceholder('Enter category title').fill('   ');
  await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();
});
