/**
 * Money formatting for the Calm Personal Ledger design.
 *
 * - Western digits (0-9) and `,` grouping / `.` decimals in every language,
 *   so amounts line up identically in Arabic and English.
 * - A true minus sign (U+2212) instead of a hyphen.
 * - Always two fraction digits.
 *
 * Bidi isolation is the renderer's job: wrap the output in `<bdi dir="ltr">`
 * (see `AmountComponent`) so the sign never flips in RTL.
 */

export type MoneyKind = 'income' | 'expense' | 'neutral';

export const MINUS_SIGN = '−';

export interface MoneyParts {
  /** '+', '−' or '' */
  sign: string;
  /** Absolute value with grouping and two decimals, e.g. "1,234.50" */
  digits: string;
}

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/**
 * Split an amount into sign and digits.
 *
 * `income` → '+', `expense` → '−' (the stored amount is a positive magnitude),
 * `neutral` → '−' only when the value is negative. Zero never gets a sign.
 */
export function formatMoneyParts(
  value: number | null | undefined,
  kind: MoneyKind = 'neutral',
  showSign = true
): MoneyParts | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const magnitude = Math.abs(n);
  const digits = numberFormatter.format(magnitude);

  let sign = '';
  if (showSign && magnitude !== 0) {
    if (kind === 'income') sign = '+';
    else if (kind === 'expense') sign = MINUS_SIGN;
    else if (n < 0) sign = MINUS_SIGN;
  } else if (!showSign && kind === 'neutral' && n < 0 && magnitude !== 0) {
    // A negative neutral value is still negative even when signs are hidden.
    sign = MINUS_SIGN;
  }

  return { sign, digits };
}

/** Plain-text form, e.g. "−842.50 USD". Returns '—' for missing values. */
export function formatMoney(
  value: number | null | undefined,
  options: {
    currency?: string | null;
    kind?: MoneyKind;
    showSign?: boolean;
  } = {}
): string {
  const parts = formatMoneyParts(value, options.kind, options.showSign ?? true);
  if (!parts) return '—';
  const currency = options.currency ? ` ${options.currency}` : '';
  return `${parts.sign}${parts.digits}${currency}`;
}
