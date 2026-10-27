import { formatMoney, formatMoneyParts, MINUS_SIGN } from './money-format.util';

describe('money-format.util', () => {
  it('formats expenses with a true minus and two decimals', () => {
    expect(formatMoneyParts(842.5, 'expense')).toEqual({
      sign: MINUS_SIGN,
      digits: '842.50',
    });
  });

  it('formats income with a plus sign and grouping', () => {
    expect(formatMoneyParts(1234567.891, 'income')).toEqual({
      sign: '+',
      digits: '1,234,567.89',
    });
  });

  it('uses the sign of the value for neutral amounts', () => {
    expect(formatMoneyParts(-50, 'neutral')?.sign).toBe(MINUS_SIGN);
    expect(formatMoneyParts(50, 'neutral')?.sign).toBe('');
  });

  it('keeps a negative neutral value negative when signs are hidden', () => {
    expect(formatMoneyParts(-50, 'neutral', false)?.sign).toBe(MINUS_SIGN);
    expect(formatMoneyParts(50, 'expense', false)?.sign).toBe('');
  });

  it('never signs zero', () => {
    expect(formatMoneyParts(0, 'expense')?.sign).toBe('');
  });

  it('returns null for missing or non-finite values', () => {
    expect(formatMoneyParts(null)).toBeNull();
    expect(formatMoneyParts(Number.NaN)).toBeNull();
  });

  it('produces plain text with currency', () => {
    expect(formatMoney(65, { kind: 'expense', currency: 'USD' })).toBe(
      `${MINUS_SIGN}65.00 USD`
    );
    expect(formatMoney(undefined)).toBe('—');
  });
});
