import {
  certificateInterest,
  convert,
  goldPerGram24,
  goldPurity,
  perGram24From,
  totals,
  valuate,
} from './vault-valuation';
import { MarketPrices, VaultAsset } from './vault.types';

const prices: MarketPrices = {
  updatedAt: '2026-11-03T00:00:00Z',
  goldUsdPerGram24: 100,
  usdPer: { USD: 1, EGP: 50, EUR: 0.9 },
};

const base = {
  ownerUserId: 'u1',
  status: 'held' as const,
  updatedAt: '2026-01-01T00:00:00Z',
  synced: 0 as const,
};

const gold = (over: Partial<VaultAsset> = {}): VaultAsset => ({
  ...base,
  id: 'g1',
  type: 'gold',
  name: 'Ring',
  purchasedAt: '2026-01-01',
  cost: { amount: 30000, currency: 'EGP' },
  details: { grams: 12, karat: 24, form: 'bar' },
  ...over,
});

describe('vault valuation', () => {
  it('works out purity from the karat', () => {
    expect(goldPurity(24)).toBe(1);
    expect(goldPurity(21)).toBeCloseTo(0.875, 6);
    expect(goldPurity(18)).toBeCloseTo(0.75, 6);
  });

  it('converts through the dollar and reports a missing rate', () => {
    expect(convert(100, 'USD', 'EGP', prices.usdPer)).toBe(5000);
    expect(convert(5000, 'EGP', 'EUR', prices.usdPer)).toBeCloseTo(90, 6);
    expect(convert(5, 'EGP', 'EGP', {})).toBe(5);
    expect(convert(5, 'EGP', 'XXX', prices.usdPer)).toBeNull();
  });

  it('prices gold from the market, or from the person’s own number', () => {
    expect(goldPerGram24('EGP', prices)).toBe(5000);
    expect(goldPerGram24('EGP', prices, { perGram24: 5200, currency: 'EGP' })).toBe(5200);
    expect(goldPerGram24('EGP', null)).toBeNull();
    expect(perGram24From(4375, 21)).toBeCloseTo(5000, 6);
  });

  it('values 24k gold: 12 g at 5000 = 60000', () => {
    const v = valuate(gold(), 'EGP', prices);
    expect(v.value).toBe(60000);
    expect(v.cost).toBe(30000);
    expect(v.gain).toBe(30000);
    expect(v.gainPct).toBe(1);
  });

  it('values 21k jewellery by purity', () => {
    const a = gold({ details: { grams: 8, karat: 21, form: 'jewelry' } });
    expect(valuate(a, 'EGP', prices).value).toBeCloseTo(8 * 0.875 * 5000, 4);
  });

  it('asks for a price instead of guessing when none is known', () => {
    const v = valuate(gold(), 'EGP', null);
    expect(v.value).toBeNull();
    expect(v.needsPrice).toBe(true);
  });

  it('values foreign cash at today’s rate against what it cost', () => {
    const a: VaultAsset = {
      ...base,
      id: 'c1',
      type: 'currency',
      name: 'Dollars',
      purchasedAt: '2026-01-01',
      cost: { amount: 45000, currency: 'EGP' },
      details: { code: 'USD', amount: 1000, rate: 45 },
    };
    const v = valuate(a, 'EGP', prices);
    expect(v.value).toBe(50000);
    expect(v.gain).toBe(5000);
    expect(v.gainPct).toBeCloseTo(5000 / 45000, 6);
  });

  it('accrues certificate interest and stops at maturity', () => {
    const d = { principal: 100000, annualRate: 24, termMonths: 12 };
    const half = certificateInterest(d, '2026-01-01', new Date('2026-07-02'));
    expect(half).toBeGreaterThan(11500);
    expect(half).toBeLessThan(12500);
    const after = certificateInterest(d, '2026-01-01', new Date('2030-01-01'));
    expect(after).toBeCloseTo(24000, 6);
  });

  it('values an investment at the price the person entered', () => {
    const a: VaultAsset = {
      ...base,
      id: 'i1',
      type: 'investment',
      name: 'Fund',
      purchasedAt: '2026-01-01',
      cost: { amount: 1000, currency: 'EGP' },
      details: { symbol: 'FND', quantity: 10, buyPrice: 100, currentPrice: 130 },
    };
    expect(valuate(a, 'EGP', prices).value).toBe(1300);
  });

  it('counts a sold item at its sale price and keeps it out of totals', () => {
    const sold = gold({ status: 'sold', saleAmount: 70000 });
    const v = valuate(sold, 'EGP', prices);
    expect(v.value).toBe(70000);
    expect(v.gain).toBe(40000);
    const t = totals([sold, gold({ id: 'g2' })], 'EGP', prices);
    expect(t.value).toBe(60000);
  });

  it('totals across types, shares add to 1, and unpriced items are skipped', () => {
    const other: VaultAsset = {
      ...base,
      id: 'o1',
      type: 'other',
      name: 'Land plot',
      purchasedAt: '2026-01-01',
      cost: { amount: 20000, currency: 'EGP' },
      details: { currentValue: 40000 },
    };
    const t = totals([gold(), other], 'EGP', prices);
    expect(t.value).toBe(100000);
    expect(t.cost).toBe(50000);
    expect(t.gain).toBe(50000);
    expect(t.byType.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
    expect(t.byType[0].type).toBe('gold');
    const none = totals([gold(), other], 'EGP', null);
    expect(none.skipped).toBe(1);
    expect(none.value).toBe(40000);
  });

  it('keeps a local gold price a fixed distance above the live market', () => {
    const local = { perGram24: 5200, currency: 'EGP', premium: 0.04, karat: 24, entered: 5200 };
    expect(goldPerGram24('EGP', prices, local)).toBeCloseTo(5200, 6);
    const later = { ...prices, goldUsdPerGram24: 110 };
    expect(goldPerGram24('EGP', later, local)).toBeCloseTo(110 * 50 * 1.04, 6);
    // offline with no prices: falls back to the price as entered
    expect(goldPerGram24('EGP', null, local)).toBe(5200);
  });

  it('ignores deleted items', () => {
    expect(totals([gold({ deleted: true })], 'EGP', prices).value).toBe(0);
  });
});
