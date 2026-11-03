export type AssetType = 'gold' | 'currency' | 'certificate' | 'investment' | 'other';
export type GoldKarat = 24 | 22 | 21 | 18 | 14 | 10 | 9;
export type GoldForm = 'bar' | 'coin' | 'jewelry';

export interface GoldDetails {
  grams: number;
  karat: GoldKarat;
  form: GoldForm;
  /** Paid per gram of this karat, in the cost currency. */
  pricePerGram?: number;
  /** Total making charge; never counted in resale value. */
  makingCharge?: number;
}
export interface CurrencyDetails {
  code: string;
  amount: number;
  /** Cost currency per 1 unit of `code` at purchase. */
  rate: number;
}
export interface CertificateDetails {
  principal: number;
  /** Yearly rate, percent. */
  annualRate: number;
  termMonths: number;
  bank?: string;
}
export interface InvestmentDetails {
  symbol: string;
  quantity: number;
  buyPrice: number;
  currentPrice?: number;
}
export interface OtherDetails {
  currentValue: number;
}

export type AssetDetails =
  | GoldDetails
  | CurrencyDetails
  | CertificateDetails
  | InvestmentDetails
  | OtherDetails;

/** One saved item, as held on the phone. `id` is also the server's clientId. */
export interface VaultAsset {
  id: string;
  ownerUserId: string;
  type: AssetType;
  name: string;
  status: 'held' | 'sold';
  /** ISO date */
  purchasedAt: string;
  cost: { amount: number; currency: string };
  details: AssetDetails;
  note?: string;
  soldAt?: string;
  saleAmount?: number;
  /** ISO timestamp of the last edit; the newer copy wins on sync. */
  updatedAt: string;
  deleted?: boolean;
  /** 1 once the server has this version. */
  synced: 0 | 1;
}

export interface MarketPrices {
  updatedAt: string;
  /** 24-karat gold, USD per gram. */
  goldUsdPerGram24: number;
  /** Units of each currency that one US dollar buys. */
  usdPer: Record<string, number>;
  stale?: boolean;
  sources?: { gold: string; fx: string };
}

export interface Valuation {
  /** Worth today (or the sale price once sold), in the base currency. */
  value: number | null;
  /** What it cost, in the base currency at today's rate when currencies differ. */
  cost: number | null;
  /** value - cost */
  gain: number | null;
  /** gain / cost, as a fraction (0.1 = +10%) */
  gainPct: number | null;
  /** True when a needed price is missing, so `value` could not be worked out. */
  needsPrice: boolean;
}
