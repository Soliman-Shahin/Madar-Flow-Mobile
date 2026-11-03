import {
  CertificateDetails,
  CurrencyDetails,
  GoldDetails,
  InvestmentDetails,
  MarketPrices,
  OtherDetails,
  Valuation,
  VaultAsset,
} from './vault.types';

/** Pure maths for the vault: no storage, no network, no Angular. */

/** Fraction of pure gold: 21 karat is 21/24 = 0.875. */
export const goldPurity = (karat: number): number => karat / 24;

/** Converts between currencies through the dollar. Null when a rate is missing. */
export function convert(
  amount: number,
  from: string,
  to: string,
  usdPer: Record<string, number>
): number | null {
  if (from === to) return amount;
  const a = usdPer[from];
  const b = usdPer[to];
  if (!a || !b) return null;
  return (amount / a) * b;
}

export interface GoldPriceOverride {
  /** Price of one gram of 24-karat gold the person typed in. */
  perGram24: number;
  currency: string;
  /** The karat the person priced and the price as typed, to show it back to them. */
  karat?: number;
  entered?: number;
  /** Local price over the international one when it was entered (0.04 = 4% above). */
  premium?: number;
  /** ISO time it was entered. */
  enteredAt?: string;
}

/** Price of one gram of 24-karat gold in `currency`, or null if unknown. */
export function goldPerGram24(
  currency: string,
  prices: MarketPrices | null,
  override?: GoldPriceOverride | null
): number | null {
  if (
    override &&
    override.premium !== undefined &&
    prices &&
    prices.usdPer[currency]
  ) {
    // the local price keeps its distance from the live international price
    return (
      prices.goldUsdPerGram24 * prices.usdPer[currency] * (1 + override.premium)
    );
  }
  if (override && override.perGram24 > 0) {
    return override.currency === currency
      ? override.perGram24
      : prices
      ? convert(override.perGram24, override.currency, currency, prices.usdPer)
      : null;
  }
  if (!prices) return null;
  const rate = prices.usdPer[currency];
  return rate ? prices.goldUsdPerGram24 * rate : null;
}

/** Price per gram of a given karat from the 24-karat price. */
export const priceForKarat = (perGram24: number, karat: number): number =>
  perGram24 * goldPurity(karat);

/** The 24-karat price implied by a price paid for another karat. */
export const perGram24From = (
  priceForKaratValue: number,
  karat: number
): number => priceForKaratValue / goldPurity(karat);

export function goldWorth(
  d: GoldDetails,
  currency: string,
  prices: MarketPrices | null,
  override?: GoldPriceOverride | null
): number | null {
  const p24 = goldPerGram24(currency, prices, override);
  return p24 === null ? null : d.grams * goldPurity(d.karat) * p24;
}

export function currencyWorth(
  d: CurrencyDetails,
  currency: string,
  prices: MarketPrices | null
): number | null {
  return prices ? convert(d.amount, d.code, currency, prices.usdPer) : null;
}

const MONTH_MS = (365.25 / 12) * 24 * 60 * 60 * 1000;

/** Whole months between two dates, fractional. */
export const monthsBetween = (from: Date, to: Date): number =>
  Math.max(0, (to.getTime() - from.getTime()) / MONTH_MS);

export function maturityDate(purchasedAt: string, termMonths: number): Date {
  const d = new Date(purchasedAt);
  d.setMonth(d.getMonth() + termMonths);
  return d;
}

/** Simple interest earned so far (stops at maturity). */
export function certificateInterest(
  d: CertificateDetails,
  purchasedAt: string,
  now: Date
): number {
  const elapsed = Math.min(
    monthsBetween(new Date(purchasedAt), now),
    d.termMonths
  );
  return d.principal * (d.annualRate / 100) * (elapsed / 12);
}

export const certificateTotalInterest = (d: CertificateDetails): number =>
  d.principal * (d.annualRate / 100) * (d.termMonths / 12);

export const investmentWorth = (d: InvestmentDetails): number =>
  d.quantity * (d.currentPrice ?? d.buyPrice);

export const otherWorth = (d: OtherDetails): number => d.currentValue;

/** Worth of one item in the item's own cost currency; null when a price is missing. */
function worthInOwnCurrency(
  a: VaultAsset,
  prices: MarketPrices | null,
  override: GoldPriceOverride | null | undefined,
  now: Date
): number | null {
  const c = a.cost.currency;
  switch (a.type) {
    case 'gold':
      return goldWorth(a.details as GoldDetails, c, prices, override);
    case 'currency':
      return currencyWorth(a.details as CurrencyDetails, c, prices);
    case 'certificate': {
      const d = a.details as CertificateDetails;
      return d.principal + certificateInterest(d, a.purchasedAt, now);
    }
    case 'investment':
      return investmentWorth(a.details as InvestmentDetails);
    default:
      return otherWorth(a.details as OtherDetails);
  }
}

/**
 * Value, cost and gain of one item in the base currency. A sold item is worth
 * what it sold for. Cost is shown in the base currency at today's rate when it
 * was paid in another one.
 */
export function valuate(
  a: VaultAsset,
  base: string,
  prices: MarketPrices | null,
  override?: GoldPriceOverride | null,
  now: Date = new Date()
): Valuation {
  const usd = prices?.usdPer ?? {};
  const cost = convert(a.cost.amount, a.cost.currency, base, usd);

  let own: number | null;
  if (a.status === 'sold') {
    own = a.saleAmount ?? a.cost.amount;
  } else {
    own = worthInOwnCurrency(a, prices, override, now);
  }
  const value = own === null ? null : convert(own, a.cost.currency, base, usd);

  if (value === null || cost === null) {
    return {
      value,
      cost,
      gain: null,
      gainPct: null,
      needsPrice: value === null,
    };
  }
  const gain = value - cost;
  return {
    value,
    cost,
    gain,
    gainPct: cost > 0 ? gain / cost : null,
    needsPrice: false,
  };
}

export interface VaultTotals {
  value: number;
  cost: number;
  gain: number;
  gainPct: number | null;
  /** Items whose price is missing and so are left out of the totals. */
  skipped: number;
  byType: Array<{ type: VaultAsset['type']; value: number; share: number }>;
}

/** Totals over held items only (sold ones are history, not savings). */
export function totals(
  assets: VaultAsset[],
  base: string,
  prices: MarketPrices | null,
  override?: GoldPriceOverride | null,
  now: Date = new Date()
): VaultTotals {
  let value = 0;
  let cost = 0;
  let skipped = 0;
  const per = new Map<VaultAsset['type'], number>();
  for (const a of assets) {
    if (a.deleted || a.status === 'sold') continue;
    const v = valuate(a, base, prices, override, now);
    if (v.value === null || v.cost === null) {
      skipped++;
      continue;
    }
    value += v.value;
    cost += v.cost;
    per.set(a.type, (per.get(a.type) ?? 0) + v.value);
  }
  const gain = value - cost;
  const byType = [...per.entries()]
    .map(([type, v]) => ({ type, value: v, share: value > 0 ? v / value : 0 }))
    .sort((x, y) => y.value - x.value);
  return {
    value,
    cost,
    gain,
    gainPct: cost > 0 ? gain / cost : null,
    skipped,
    byType,
  };
}
