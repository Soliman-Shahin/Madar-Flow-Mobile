import {
  buildExportRows,
  csvCell,
  exportFileName,
  periodRange,
  summarize,
  toCsv,
} from './export-data.util';

const labels = {
  date: 'Date',
  type: 'Type',
  category: 'Category',
  description: 'Description',
  amount: 'Amount',
  income: 'Income',
  expense: 'Expense',
};

const categories = [
  { _id: 'c-food', title: 'Foods', type: 'outcome' },
  { _id: 'c-salary', title: 'Salary', type: 'income' },
  { _id: 'c-gone', title: 'Old', type: 'outcome', _isDeleted: true },
];

describe('export data util', () => {
  describe('periodRange', () => {
    const now = new Date(2026, 9, 30, 15, 0); // 30 Oct 2026, local

    it('resolves calendar periods in local time', () => {
      expect(periodRange('this-month', now)).toEqual({
        start: new Date(2026, 9, 1),
        end: new Date(2026, 10, 1),
      });
      expect(periodRange('last-month', now)).toEqual({
        start: new Date(2026, 8, 1),
        end: new Date(2026, 9, 1),
      });
      expect(periodRange('last-3-months', now).start).toEqual(
        new Date(2026, 7, 1)
      );
      expect(periodRange('this-year', now)).toEqual({
        start: new Date(2026, 0, 1),
        end: new Date(2027, 0, 1),
      });
    });

    it('rolls back across a year boundary', () => {
      expect(periodRange('last-month', new Date(2026, 0, 15)).start).toEqual(
        new Date(2025, 11, 1)
      );
    });

    it('has no bounds for all time', () => {
      expect(periodRange('all', now)).toEqual({ start: null, end: null });
    });
  });

  describe('buildExportRows', () => {
    it('joins categories, skips deleted/invalid rows and sorts newest first', () => {
      const rows = buildExportRows(
        [
          { description: ' Lunch ', amount: 80, category: 'c-food', date: new Date(2026, 9, 2) },
          { description: 'Pay', amount: '5000', category: 'c-salary', date: new Date(2026, 9, 5) },
          { description: 'Deleted', amount: 1, category: 'c-food', date: new Date(2026, 9, 6), _isDeleted: true },
          { description: 'No date', amount: 1, category: 'c-food' },
          { description: 'NaN', amount: 'abc', category: 'c-food', date: new Date(2026, 9, 7) },
          { description: 'Orphan', amount: 3, category: 'missing', date: new Date(2026, 9, 3) },
        ],
        categories,
        { start: null, end: null },
        'Uncategorized'
      );
      expect(rows.map((r) => r.description)).toEqual(['Pay', 'Orphan', 'Lunch']);
      expect(rows[0]).toEqual({ date: '2026-10-05', type: 'income', category: 'Salary', description: 'Pay', amount: 5000 });
      expect(rows[1].category).toBe('Uncategorized');
      expect(rows[2].description).toBe('Lunch');
    });

    it('accepts a populated category object and filters by range', () => {
      const rows = buildExportRows(
        [
          { description: 'In', amount: 1, category: { title: 'Pop', type: 'income' }, date: new Date(2026, 9, 10) },
          { description: 'Out', amount: 1, category: 'c-food', date: new Date(2026, 8, 30) },
        ],
        categories,
        { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) }
      );
      expect(rows.length).toBe(1);
      expect(rows[0].type).toBe('income');
    });
  });

  describe('summarize', () => {
    it('totals income/expense, ranks categories and groups by month', () => {
      const s = summarize([
        { date: '2026-10-05', type: 'income', category: 'Salary', description: '', amount: 1000 },
        { date: '2026-10-06', type: 'expense', category: 'Foods', description: '', amount: 300 },
        { date: '2026-10-07', type: 'expense', category: 'Car', description: '', amount: 100 },
        { date: '2026-09-07', type: 'expense', category: 'Foods', description: '', amount: 100 },
      ]);
      expect(s.income).toBe(1000);
      expect(s.expense).toBe(500);
      expect(s.net).toBe(500);
      expect(s.count).toBe(4);
      expect(s.expenseByCategory.map((c) => c.category)).toEqual(['Foods', 'Car']);
      expect(s.expenseByCategory[0].share).toBeCloseTo(0.8);
      expect(s.byMonth.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    });

    it('is safe on empty input', () => {
      const s = summarize([]);
      expect(s).toEqual({ count: 0, income: 0, expense: 0, net: 0, expenseByCategory: [], byMonth: [] });
    });
  });

  describe('CSV', () => {
    it('escapes quotes and neutralizes formula injection', () => {
      expect(csvCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
      expect(csvCell('+1')).toBe('"\'+1"');
      expect(csvCell('-2')).toBe('"\'-2"');
      expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
      expect(csvCell('safe')).toBe('"safe"');
    });

    it('writes a BOM, a header, CRLF rows and plain numeric amounts', () => {
      const csv = toCsv(
        [
          { date: '2026-10-05', type: 'income', category: 'Salary', description: 'a,b', amount: 1000 },
          { date: '2026-10-06', type: 'expense', category: 'قهوة', description: '=1+1', amount: 12.5 },
        ],
        labels
      );
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      const lines = csv.slice(1).split('\r\n');
      expect(lines[0]).toBe('"Date","Type","Category","Description","Amount"');
      expect(lines[1]).toBe('"2026-10-05","Income","Salary","a,b",1000.00');
      expect(lines[2]).toBe('"2026-10-06","Expense","قهوة","\'=1+1",12.50');
      expect(lines[3]).toBe('');
    });
  });

  it('builds a dated file name', () => {
    expect(exportFileName('csv', 'this-month', new Date(2026, 9, 30))).toBe(
      'madar-flow-this-month-2026-10-30.csv'
    );
  });
});
