/**
 * Day grouping helpers for the Calm Personal Ledger lists.
 * Dates use the local calendar day, Western digits, and one format in both
 * languages ("27 October" / "27 أكتوبر", year only when it is not this year).
 */

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface LedgerDayLabels {
  today: string;
  yesterday: string;
}

export function ledgerDayLabel(
  date: Date,
  lang: string,
  labels: LedgerDayLabels,
  now: Date = new Date()
): string {
  const today = localDateKey(now);
  const yesterday = localDateKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  );
  const key = localDateKey(date);
  if (key === today) return labels.today;
  if (key === yesterday) return labels.yesterday;

  return new Intl.DateTimeFormat(lang || 'en', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    numberingSystem: 'latn',
  }).format(date);
}

export interface LedgerDayGroup<T> {
  key: string;
  label: string;
  /** Signed net for the day: income positive, expenses negative. */
  net: number;
  items: T[];
}

/**
 * Group items (already sorted newest first) by local calendar day.
 * `signedAmount` returns +amount for income and −amount for expenses.
 */
export function groupByLedgerDay<T>(
  items: readonly T[],
  getDate: (item: T) => Date,
  signedAmount: (item: T) => number,
  label: (date: Date) => string
): LedgerDayGroup<T>[] {
  const groups = new Map<string, LedgerDayGroup<T>>();
  for (const item of items) {
    const date = getDate(item);
    const key = localDateKey(date);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: label(date), net: 0, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
    const value = Number(signedAmount(item));
    if (Number.isFinite(value)) group.net += value;
  }
  for (const group of groups.values()) {
    // Avoid floating-point noise such as 0.30000000000000004.
    group.net = Math.round(group.net * 100) / 100;
  }
  return Array.from(groups.values());
}
