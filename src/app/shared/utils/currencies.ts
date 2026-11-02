/** Currencies a user can pick for their account (profile page and the first-sign-in prompt). */
export const SUPPORTED_CURRENCIES: readonly string[] = [
  'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'MAD', 'DZD', 'TND',
];

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', SA: 'SAR', AE: 'AED', KW: 'KWD', QA: 'QAR', BH: 'BHD',
  OM: 'OMR', EG: 'EGP', MA: 'MAD', DZ: 'DZD', TN: 'TND',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR',
};

/** The currency most likely wanted, from the device region (first supported one when unknown). */
export function suggestCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region ?? '';
    const code = REGION_CURRENCY[region];
    if (code && SUPPORTED_CURRENCIES.includes(code)) return code;
  } catch {
    /* fall through */
  }
  return SUPPORTED_CURRENCIES[0];
}
