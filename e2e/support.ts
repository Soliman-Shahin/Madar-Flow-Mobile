import { APIRequestContext, expect, Page } from '@playwright/test';

export const EMAIL = process.env.E2E_EMAIL || 'qa-user-free@madarflow.test';
export const PASSWORD = process.env.E2E_PASSWORD || '';
const API = (process.env.E2E_API_TARGET || 'http://localhost:3111') + '/v1';

export function requirePassword(): void {
  if (!PASSWORD) throw new Error('Set E2E_PASSWORD to the seeded QA password (see playwright.config.ts).');
}

/** Fill the Ionic login form and submit. Does not assert the outcome. */
export async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/login');
  const emailInput = page.locator('#login-email input');
  await expect(emailInput).toBeVisible();
  await emailInput.fill(email);
  await page.locator('#login-password input').fill(password);
  await page.locator('ion-button[type="submit"]').click();
}

/**
 * Log in through the real UI. Each test signs in itself (a stored session cannot be shared:
 * refresh tokens rotate), which costs ~1 login per test; the QA backend allows 100 per 15 min.
 */
export async function login(page: Page, email: string = EMAIL): Promise<void> {
  requirePassword();
  await submitLogin(page, email, PASSWORD);
  await expect(page).not.toHaveURL(/\/auth\//, { timeout: 20_000 });
}

export const loginFresh = login;

let cachedToken: string | undefined;

/** Log in against the QA API once per worker and reuse the token for server-side checks. */
export async function apiAuth(request: APIRequestContext) {
  requirePassword();
  if (!cachedToken) {
    const res = await request.post(`${API}/user/login`, { data: { email: EMAIL, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    cachedToken = (await res.json()).data.accessToken as string;
  }
  return { headers: { Authorization: `Bearer ${cachedToken}` } };
}

export const NO_CURRENCY_EMAIL = 'qa-user-nocurrency@madarflow.test';

export async function apiGet<T = any>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, await apiAuth(request));
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data as T;
}
