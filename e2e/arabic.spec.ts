import { expect, Page, test } from './fixtures';
import { login } from './support';

/** Raw i18n keys such as MOBILE.CURRENCY_UNAVAILABLE on screen mean a missing translation. */
const RAW_KEY = /\b[A-Z][A-Z0-9_]{2,}\.[A-Z][A-Z0-9_]{2,}(\.[A-Z0-9_]+)*\b/;

async function expectHealthyArabicScreen(page: Page, label: string) {
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const text = await page.locator('body').innerText();
  expect(text, `${label}: untranslated key on screen`).not.toMatch(RAW_KEY);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

test('Arabic switches the app to RTL with no missing translations on the main screens', async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByRole('button', { name: /العربية|Arabic/ }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expectHealthyArabicScreen(page, 'login');

  await login(page);
  for (const path of ['/home', '/transactions/list', '/categories/list', '/settings']) {
    await page.goto(path).catch(() => undefined);
    await page.waitForTimeout(2500);
    if (/\/auth\//.test(page.url())) await login(page); // a hard reload drops a non-remembered session
    await expectHealthyArabicScreen(page, path);
  }
});
