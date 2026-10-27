import { groupByLedgerDay, ledgerDayLabel, localDateKey } from './ledger-day.util';

describe('ledger-day.util', () => {
  const labels = { today: 'Today', yesterday: 'Yesterday' };
  const now = new Date(2026, 9, 27, 15, 0); // 27 Oct 2026, local time

  it('labels today and yesterday by local calendar day', () => {
    expect(ledgerDayLabel(new Date(2026, 9, 27, 0, 5), 'en', labels, now)).toBe(
      'Today'
    );
    expect(ledgerDayLabel(new Date(2026, 9, 26, 23, 59), 'en', labels, now)).toBe(
      'Yesterday'
    );
  });

  it('uses day + month without the year for the current year', () => {
    expect(ledgerDayLabel(new Date(2026, 9, 22), 'en', labels, now)).toBe(
      'October 22'
    );
  });

  it('adds the year for other years', () => {
    expect(ledgerDayLabel(new Date(2025, 11, 31), 'en', labels, now)).toContain(
      '2025'
    );
  });

  it('keeps Western digits in Arabic', () => {
    const label = ledgerDayLabel(new Date(2026, 9, 22), 'ar', labels, now);
    expect(label).toContain('22');
    expect(/[٠-٩]/.test(label)).toBeFalse();
  });

  it('groups by day and computes a signed net per day', () => {
    const items = [
      { d: new Date(2026, 9, 27, 10), amount: 842.5, income: false },
      { d: new Date(2026, 9, 25, 9), amount: 65, income: false },
      { d: new Date(2026, 9, 25, 8), amount: 24500, income: true },
    ];
    const groups = groupByLedgerDay(
      items,
      (i) => i.d,
      (i) => (i.income ? 1 : -1) * i.amount,
      (d) => localDateKey(d)
    );
    expect(groups.length).toBe(2);
    expect(groups[0].net).toBe(-842.5);
    expect(groups[1].net).toBe(24435);
    expect(groups[1].items.length).toBe(2);
  });

  it('rounds away floating point noise', () => {
    const groups = groupByLedgerDay(
      [0.1, 0.2],
      () => now,
      (v) => v,
      () => 'x'
    );
    expect(groups[0].net).toBe(0.3);
  });
});
