import { expect, test } from './fixtures';
import { EMAIL, PASSWORD, loginFresh, requirePassword, submitLogin } from './support';

test.describe('authentication', () => {
  test('login page renders its form and links', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('#login-email input')).toBeVisible();
    await expect(page.locator('#login-password input')).toBeVisible();
    await expect(page.locator('a[href="/auth/signup"]').first()).toBeVisible();
    await expect(page.locator('a[href="/auth/forgot-password"]')).toBeVisible();
  });

  test('protected routes redirect an anonymous visitor to login', async ({ page }) => {
    for (const path of ['/transactions', '/categories', '/settings']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/login|\/home/, { timeout: 15_000 });
      await expect(page).not.toHaveURL(new RegExp(`${path}$`));
    }
  });

  test('wrong password shows an error and keeps the user on login', async ({ page }) => {
    requirePassword();
    await submitLogin(page, EMAIL, `${PASSWORD}-wrong`);
    await expect(page.locator('.mf-auth__error')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/auth\/login/);
    // Nothing that looks like a session is persisted after a failed login.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toMatch(/accessToken|refreshToken/i);
  });

  test('empty form keeps submit disabled and never reaches the API', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/api/v1/user/login')) apiCalls.push(r.url()); });
    await page.goto('/auth/login');
    const submit = page.locator('ion-button[type="submit"]');
    await expect(submit).toHaveClass(/button-disabled/);
    await submit.click({ force: true });
    await page.waitForTimeout(800);
    expect(apiCalls).toHaveLength(0);
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('valid login reaches the app and survives a reload', async ({ page }) => {
    await loginFresh(page);
    await page.reload();
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 20_000 });
  });

  test('login request body is not plaintext credentials', async ({ page }) => {
    requirePassword();
    const bodies: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/api/v1/user/login')) bodies.push(r.postData() || ''); });
    await submitLogin(page, EMAIL, PASSWORD);
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(bodies[0]).not.toContain(PASSWORD);
  });
});
