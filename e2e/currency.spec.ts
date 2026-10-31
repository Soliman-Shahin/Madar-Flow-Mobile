import { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { login, NO_CURRENCY_EMAIL, PASSWORD } from './support';

const API = (process.env.E2E_API_TARGET || 'http://localhost:3111') + '/v1';

async function serverCurrency(request: APIRequestContext): Promise<string | undefined> {
  const res = await request.post(`${API}/user/login`, { data: { email: NO_CURRENCY_EMAIL, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data.user.currency;
}

test('"Later" dismisses the prompt without choosing a currency', async ({ page, request }) => {
  await login(page, NO_CURRENCY_EMAIL);
  const prompt = page.getByRole('alertdialog');
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await prompt.getByRole('button', { name: 'Later' }).click();
  await expect(prompt).toBeHidden();
  expect(await serverCurrency(request)).toBeFalsy();
});

test('an account without a currency is asked to choose one after signing in, and it is stored', async ({ page, request }) => {
  await login(page, NO_CURRENCY_EMAIL);
  const prompt = page.getByRole('alertdialog');
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await expect(prompt.getByText('Choose your currency')).toBeVisible();

  await prompt.getByRole('radio', { name: 'EGP' }).click();
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(prompt).toBeHidden();

  await expect.poll(() => serverCurrency(request), { timeout: 20_000 }).toBe('EGP');
});
