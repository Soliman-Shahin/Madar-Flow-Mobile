import { AssetType, GoldKarat } from './vault.types';

export const ASSET_TYPES: readonly AssetType[] = [
  'gold',
  'currency',
  'certificate',
  'investment',
  'other',
];

/** Icon and chart colour for each kind. Colour only marks the data. */
export const ASSET_META: Record<AssetType, { icon: string; color: string }> = {
  gold: { icon: 'diamond-outline', color: 'var(--mf-cat-3)' },
  currency: { icon: 'cash-outline', color: 'var(--mf-cat-2)' },
  certificate: { icon: 'ribbon-outline', color: 'var(--mf-cat-1)' },
  investment: { icon: 'trending-up-outline', color: 'var(--mf-cat-4)' },
  other: { icon: 'cube-outline', color: 'var(--mf-cat-8)' },
};

export const KARATS: readonly GoldKarat[] = [24, 22, 21, 18, 14, 10, 9];

/** Currencies the free price source covers (the same list the server serves). */
export const VAULT_CURRENCIES: readonly string[] = [
  'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK',
  'EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'LBP', 'IQD', 'LYD', 'TND',
  'MAD', 'DZD', 'SDG', 'YER', 'SYP', 'TRY', 'INR', 'PKR', 'IDR', 'MYR', 'SGD', 'THB',
  'KRW', 'RUB', 'ZAR', 'NGN', 'KES', 'BRL', 'MXN', 'ILS',
];

/** Currency name in the app language, falling back to the code. */
export function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Plain-number formatting (no currency symbol), grouped, up to `max` decimals. */
export function formatNumber(value: number, locale: string, max = 2): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: max }).format(value);
  } catch {
    return String(value);
  }
}

/** yyyy-mm-dd for a date input, from an ISO string or Date. */
export function toDateInput(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
