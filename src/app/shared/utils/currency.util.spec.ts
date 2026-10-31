import { formatCurrency } from './currency.util';

describe('formatCurrency', () => {
  it('formats with the currency when one is chosen', () => {
    expect(formatCurrency(12.5, 'EGP', 'en-US')).toMatch(/12\.50/);
    expect(formatCurrency(12.5, 'EGP', 'en-US')).toMatch(/EGP|E£/);
  });

  it('never guesses a currency: with none it shows the plain amount (D-024)', () => {
    const text = formatCurrency(1234.5, '', 'en-US');
    expect(text).toBe('1,234.5');
    expect(text).not.toMatch(/\$|USD/);
    expect(formatCurrency(1234.5, undefined, 'en-US')).toBe('1,234.5');
  });

  it('keeps the placeholder for missing amounts', () => {
    expect(formatCurrency(null, 'EGP')).toBe('—');
  });
});
