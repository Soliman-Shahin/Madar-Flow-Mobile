export function formatCurrency(
  value: number | null | undefined,
  currencyCode: string = '',
  locale: string = typeof navigator !== 'undefined'
    ? navigator.language
    : 'en-US'
): string {
  if (value == null || !isFinite(Number(value))) return '—';
  try {
    // No currency chosen yet: show the plain amount instead of guessing a code.
    if (!currencyCode) {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value));
    }
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return String(value);
  }
}
