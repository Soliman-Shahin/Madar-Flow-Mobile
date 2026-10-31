import { test as base, expect } from '@playwright/test';

/**
 * Base test: a returning visitor. The first-run onboarding overlay covers the whole app and
 * re-appears whenever its stored version changes, so the "already completed" state is seeded
 * before the app boots (keys mirror OnboardingService: madarflow_onboarding_status / madarflow_app_version).
 * Tests of the onboarding itself should use `freshVisitorTest`.
 */
const ONBOARDING_VERSION = '1.0.1'; // keep in sync with OnboardingService.checkVersionUpdate

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((version) => {
      try {
        localStorage.setItem('madarflow_onboarding_status', JSON.stringify({ steps: [], currentStep: 0, isCompleted: true, isSkipped: false }));
        localStorage.setItem('madarflow_app_version', JSON.stringify(version));
      } catch { /* storage unavailable */ }
    }, ONBOARDING_VERSION);
    await use(page);
  },
});

export const freshVisitorTest = base;
export { expect };
