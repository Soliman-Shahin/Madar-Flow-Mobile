import { localDateKey } from 'src/app/shared/utils/ledger-day.util';

export type ExportPeriod =
  | 'this-month'
  | 'last-month'
  | 'last-3-months'
  | 'this-year'
  | 'all';

export interface ExportRow {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  type: 'income' | 'expense';
  category: string;
  description: string;
  /** Positive magnitude, as stored. */
  amount: number;
}

export interface DateRange {
  /** Inclusive local start of day, or null for no lower bound. */
  start: Date | null;
  /** Exclusive local end, or null for no upper bound. */
  end: Date | null;
}

export interface CategoryTotal {
  category: string;
  total: number;
  share: number;
}

export interface MonthTotal {
  /** YYYY-MM */
  month: string;
  income: number;
  expense: number;
}

export interface ExportSummary {
  count: number;
  income: number;
  expense: number;
  net: number;
  /** Expense totals, largest first. */
  expenseByCategory: CategoryTotal[];
  /** Chronological. */
  byMonth: MonthTotal[];
}

interface RawCategory {
  _id?: string;
  _clientId?: string;
  title?: string;
  type?: string;
  _isDeleted?: boolean;
}

interface RawExpense {
  _id?: string;
  description?: string;
  amount?: number | string;
  category?: RawCategory | string | null;
  date?: Date | string;
  _isDeleted?: boolean;
}

/** Resolve a period to a [start, end) range in local time. */
export function periodRange(
  period: ExportPeriod,
  now: Date = new Date()
): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'this-month':
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    case 'last-month':
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    case 'last-3-months':
      return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1) };
    case 'this-year':
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
    default:
      return { start: null, end: null };
  }
}

/**
 * Join stored expenses with their categories into flat export rows.
 * Deleted rows and rows without a usable date or amount are skipped; the
 * result is sorted newest first.
 */
export function buildExportRows(
  expenses: RawExpense[],
  categories: RawCategory[],
  range: DateRange = { start: null, end: null },
  uncategorizedLabel = 'Uncategorized'
): ExportRow[] {
  const byId = new Map<string, RawCategory>();
  for (const c of categories) {
    if (c._isDeleted) continue;
    if (c._id) byId.set(String(c._id), c);
    if (c._clientId) byId.set(String(c._clientId), c);
  }

  const rows: ExportRow[] = [];
  for (const e of expenses) {
    if (e._isDeleted) continue;
    const when = e.date ? new Date(e.date) : null;
    const amount = Number(e.amount);
    if (!when || isNaN(when.getTime()) || !isFinite(amount)) continue;
    if (range.start && when < range.start) continue;
    if (range.end && when >= range.end) continue;

    const ref = e.category;
    const cat: RawCategory | undefined =
      ref && typeof ref === 'object' ? ref : byId.get(String(ref ?? ''));
    rows.push({
      date: localDateKey(when),
      type: cat?.type === 'income' ? 'income' : 'expense',
      category: (cat?.title ?? '').trim() || uncategorizedLabel,
      description: (e.description ?? '').trim(),
      amount,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows;
}

export function summarize(rows: ExportRow[]): ExportSummary {
  let income = 0;
  let expense = 0;
  const cats = new Map<string, number>();
  const months = new Map<string, MonthTotal>();

  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const bucket = months.get(month) ?? { month, income: 0, expense: 0 };
    if (r.type === 'income') {
      income += r.amount;
      bucket.income += r.amount;
    } else {
      expense += r.amount;
      bucket.expense += r.amount;
      cats.set(r.category, (cats.get(r.category) ?? 0) + r.amount);
    }
    months.set(month, bucket);
  }

  const expenseByCategory = [...cats.entries()]
    .map(([category, total]) => ({
      category,
      total,
      share: expense > 0 ? total / expense : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    count: rows.length,
    income,
    expense,
    net: income - expense,
    expenseByCategory,
    byMonth: [...months.values()].sort((a, b) =>
      a.month < b.month ? -1 : a.month > b.month ? 1 : 0
    ),
  };
}

/**
 * Neutralize spreadsheet formula injection and escape for CSV.
 * Values that a spreadsheet would treat as a formula (leading = + - @ tab or
 * CR) are prefixed with an apostrophe, then every field is quoted.
 */
export function csvCell(value: string | number): string {
  let text = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

export interface CsvLabels {
  date: string;
  type: string;
  category: string;
  description: string;
  amount: string;
  income: string;
  expense: string;
}

/** UTF-8 CSV with a BOM so Excel reads Arabic text correctly. */
export function toCsv(rows: ExportRow[], labels: CsvLabels): string {
  const header = [
    labels.date,
    labels.type,
    labels.category,
    labels.description,
    labels.amount,
  ]
    .map(csvCell)
    .join(',');
  const lines = rows.map((r) =>
    [
      csvCell(r.date),
      csvCell(r.type === 'income' ? labels.income : labels.expense),
      csvCell(r.category),
      csvCell(r.description),
      // Numbers are written plain (no quotes) so spreadsheets keep them numeric.
      r.amount.toFixed(2),
    ].join(',')
  );
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

export function exportFileName(
  ext: 'csv' | 'pdf',
  period: ExportPeriod,
  now: Date = new Date()
): string {
  return `madar-flow-${period}-${localDateKey(now)}.${ext}`;
}
