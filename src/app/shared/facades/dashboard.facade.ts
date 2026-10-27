import { Injectable, inject } from '@angular/core';
import {
  Observable,
  map,
  shareReplay,
  forkJoin,
  of,
  switchMap,
  catchError,
} from 'rxjs';
import { ChartDataService } from '../services/chart-data.service';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { NamedValue } from 'src/app/shared/models';
import { ExpenseService } from 'src/app/core/services/expense.service';
import { CategoryService } from 'src/app/modules/categories/services/categories.service';
import { Category, Expense } from 'src/app/shared/models';

@Injectable({ providedIn: 'root' })
export class DashboardFacade {
  private readonly charts = inject(ChartDataService);
  readonly profile = inject(ProfileService);
  private readonly expenses = inject(ExpenseService);
  private readonly categories = inject(CategoryService);

  // Chart streams
  readonly incomeVsExpense$: Observable<NamedValue[]> =
    this.charts.getIncomeVsExpense();
  readonly expenseByCategory$: Observable<NamedValue[]> =
    this.charts.getExpenseByCategory();
  readonly monthlyExpenses$: Observable<NamedValue[]> =
    this.charts.getMonthlyExpenses();
  readonly salaryBreakdown$: Observable<NamedValue[]> =
    this.charts.getSalaryBreakdown();

  // Profile stream (currency, salary, etc.)
  readonly profile$ = this.profile.profile$;

  // Derived totals from income vs expense stream
  readonly totals$ = this.incomeVsExpense$.pipe(
    map((pairs) => {
      const income =
        pairs.find((p) => p.name.toLowerCase() === 'income')?.value ?? 0;
      const expenses =
        pairs.find((p) => p.name.toLowerCase() === 'expenses')?.value ?? 0;
      const balance = income - expenses;
      return { income, expenses, balance } as const;
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // API-backed totals helpers
  totalsForRange(
    startDate: Date,
    endDate: Date
  ): Observable<{ income: number; expenses: number; balance: number }> {
    const normalize = (val: any) => {
      const income = Number((val || {}).income ?? 0);
      const expenses = Number((val || {}).expenses ?? 0);
      return {
        income: isFinite(income) ? income : 0,
        expenses: isFinite(expenses) ? expenses : 0,
      };
    };
    return this.expenses.getTotals(startDate, endDate).pipe(
      map((res) => {
        const { income, expenses } = normalize(res);
        return { income, expenses, balance: income - expenses };
      }),
      // If API fails, compute locally
      catchError(() => this.computeTotalsFromExpenses(startDate, endDate)),
      // If API returns zeros, try to compute locally (covers backends without totals endpoint)
      switchMap((res) =>
        res && (res.income !== 0 || res.expenses !== 0)
          ? of(res)
          : this.computeTotalsFromExpenses(startDate, endDate)
      )
    );
  }

  /**
   * Profile salary is stored separately from expense transactions. The API
   * totals endpoint aggregates transaction categories only, so callers must
   * combine the two sources consistently.
   */
  withProfileIncome(
    totals: { income: number; expenses: number; balance: number },
    profile: { salary?: Array<{ amount?: number }> | number } | null
  ) {
    const salaryEntries = Array.isArray(profile?.salary)
      ? profile.salary
      : profile?.salary != null
      ? [{ amount: profile.salary }]
      : [];
    const salaryIncome = salaryEntries.reduce(
      (sum, item) => sum + (Number(item?.amount) || 0),
      0
    );
    const income = totals.income + salaryIncome;
    return {
      income,
      expenses: totals.expenses,
      balance: income - totals.expenses,
    };
  }

  totalsForMonth(
    month: number,
    year: number
  ): Observable<{ income: number; expenses: number; balance: number }> {
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    return this.totalsForRange(startDate, endDate);
  }

  expenseComparisonForMonth(
    month: number,
    year: number
  ): Observable<{
    current: number;
    previous: number;
    direction: 'less' | 'more' | 'same' | 'new' | 'none';
    percentage: number | null;
  }> {
    const currentStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const nextMonthStart = new Date(year, month, 1, 0, 0, 0, 0);
    const previousStart = new Date(year, month - 2, 1, 0, 0, 0, 0);

    return this.expenses.getExpenses().pipe(
      map((expenses) => {
        let current = 0;
        let previous = 0;
        for (const expense of expenses) {
          if ((expense as any)._isDeleted) continue;
          const rawDate = (expense as any)?.date;
          if (!rawDate) continue;
          const date = new Date(rawDate);
          if (!Number.isFinite(date.getTime())) continue;
          const categoryType =
            expense.category && typeof expense.category === 'object'
              ? (expense.category as any).type
              : undefined;
          const type = String(
            (expense as any)?.type || categoryType || 'outcome'
          ).toLowerCase();
          if (type === 'income') continue;
          const amount = Number(expense.amount);
          if (!Number.isFinite(amount)) continue;
          if (date >= currentStart && date < nextMonthStart) current += amount;
          else if (date >= previousStart && date < currentStart)
            previous += amount;
        }
        if (current === 0 && previous === 0) {
          return {
            current,
            previous,
            direction: 'none' as const,
            percentage: null,
          };
        }
        if (previous === 0) {
          return {
            current,
            previous,
            direction: 'new' as const,
            percentage: null,
          };
        }
        if (current === previous) {
          return {
            current,
            previous,
            direction: 'same' as const,
            percentage: 0,
          };
        }
        const delta = current - previous;
        return {
          current,
          previous,
          direction: delta < 0 ? ('less' as const) : ('more' as const),
          percentage: Math.abs((delta / previous) * 100),
        };
      })
    );
  }

  incomeTransactionsForRange(
    startDate: Date,
    endDate: Date
  ): Observable<{ count: number; sum: number }> {
    const startInclusive = startDate.getTime();
    const endExclusive = endDate.getTime();
    return this.expenses.getExpenses().pipe(
      map((resp) => {
        const expenses: Expense[] = Array.isArray(resp)
          ? (resp as Expense[])
          : (resp as any)?.data?.data || (resp as any)?.data || [];
        let count = 0;
        let sum = 0;
        for (const expense of expenses) {
          const rawDate = expense?.date || expense?.createdAt;
          const timestamp = rawDate ? new Date(rawDate).getTime() : NaN;
          if (
            !Number.isFinite(timestamp) ||
            timestamp < startInclusive ||
            timestamp >= endExclusive
          ) {
            continue;
          }
          const categoryType =
            expense?.category && typeof expense.category === 'object'
              ? (expense.category as any).type
              : undefined;
          const transactionType =
            (expense as any)?.type || categoryType || 'outcome';
          if (String(transactionType).toLowerCase() !== 'income') continue;

          const amount = Number(expense.amount);
          if (!Number.isFinite(amount)) continue;
          count++;
          sum += amount;
        }
        return { count, sum };
      })
    );
  }

  // Compute expense distribution by category for a custom date range
  expenseByCategoryForRange(
    startDate: Date,
    endDate: Date
  ): Observable<NamedValue[]> {
    const startInclusive = startDate.getTime();
    const endExclusive = endDate.getTime();
    return forkJoin({
      categoriesResp: this.categories.getCategories({
        skip: 0,
        limit: 1000,
        sort: 'name',
      }),
      expenses: this.expenses.getExpenses(),
    }).pipe(
      map(({ categoriesResp, expenses }) => {
        const categoriesWrapped = categoriesResp as
          | { data?: Category[] | { data?: Category[] }; total?: number }
          | Category[];
        const categories: Category[] = Array.isArray(categoriesWrapped)
          ? categoriesWrapped
          : (categoriesWrapped?.data as any)?.data ??
            (categoriesWrapped?.data as Category[]) ??
            [];
        const byId = new Map<
          string,
          { name: string; type?: string; color?: string }
        >();
        categories.forEach((c) =>
          byId.set(c._id, {
            name: (c as any).title || c.title,
            type: (c as any).type,
            color: (c as any).color,
          })
        );

        const expArr: Expense[] = Array.isArray(expenses)
          ? (expenses as Expense[])
          : (expenses as any)?.data?.data || (expenses as any)?.data || [];
        const sums = new Map<string, number>();
        const colors = new Map<string, string>();

        expArr
          .filter((e) => {
            const rawDate = e?.date || e?.createdAt;
            if (!rawDate) return false;
            const t = new Date(rawDate).getTime();
            return t >= startInclusive && t < endExclusive;
          })
          .forEach((e) => {
            // Only aggregate expense (non-income) categories
            let name = 'Uncategorized';
            let catType: string | undefined;
            let catColor: string | undefined;
            if (e.category && typeof e.category === 'object') {
              name =
                (e.category as any).title || (e.category as any).title || name;
              catType = (e.category as any).type;
              catColor = (e.category as any).color;
            } else if (typeof e.category === 'string') {
              const meta = byId.get(e.category);
              if (meta) {
                name = meta.name;
                catType = meta.type;
                catColor = meta.color;
              }
            }
            if (catColor && !colors.has(name)) colors.set(name, catColor);
            const typeLower = (catType ?? '').toString().toLowerCase();
            if (typeLower === 'income') return; // skip income lines

            const amt = Number(e.amount);
            if (!Number.isFinite(amt) || Number.isNaN(amt)) return;
            sums.set(name, (sums.get(name) || 0) + amt);
          });

        return Array.from(sums.entries())
          .map(([name, value]) => ({ name, value, color: colors.get(name) }))
          .sort((a, b) => b.value - a.value);
      })
    );
  }

  // Compute expense distribution by category for a given month from real data
  expenseByCategoryForMonth(
    month: number,
    year: number
  ): Observable<NamedValue[]> {
    const startInclusive = new Date(year, month - 1, 1).getTime();
    const endExclusive = new Date(year, month, 1).getTime();
    return forkJoin({
      categoriesResp: this.categories.getCategories({
        skip: 0,
        limit: 1000,
        sort: 'name',
      }),
      expenses: this.expenses.getExpenses(),
    }).pipe(
      map(({ categoriesResp, expenses }) => {
        const categoriesWrapped = categoriesResp as
          | { data?: Category[] | { data?: Category[] }; total?: number }
          | Category[];
        const categories: Category[] = Array.isArray(categoriesWrapped)
          ? categoriesWrapped
          : (categoriesWrapped?.data as any)?.data ??
            (categoriesWrapped?.data as Category[]) ??
            [];
        const byId = new Map<
          string,
          { name: string; type?: string; color?: string }
        >();
        categories.forEach((c) =>
          byId.set(c._id, {
            name: (c as any).title || c.title,
            type: (c as any).type,
            color: (c as any).color,
          })
        );

        const expArr: Expense[] = Array.isArray(expenses)
          ? (expenses as Expense[])
          : (expenses as any)?.data?.data || (expenses as any)?.data || [];
        const sums = new Map<string, number>();
        const colors = new Map<string, string>();

        expArr
          .filter((e) => {
            const rawDate = e?.date || e?.createdAt;
            if (!rawDate) return false;
            const t = new Date(rawDate).getTime();
            return t >= startInclusive && t < endExclusive;
          })
          .forEach((e) => {
            // Only aggregate expense (non-income) categories
            let name = 'Uncategorized';
            let catType: string | undefined;
            let catColor: string | undefined;
            if (e.category && typeof e.category === 'object') {
              name =
                (e.category as any).title || (e.category as any).title || name;
              catType = (e.category as any).type;
              catColor = (e.category as any).color;
            } else if (typeof e.category === 'string') {
              const meta = byId.get(e.category);
              if (meta) {
                name = meta.name;
                catType = meta.type;
                catColor = meta.color;
              }
            }
            if (catColor && !colors.has(name)) colors.set(name, catColor);
            const typeLower = (catType ?? '').toString().toLowerCase();
            if (typeLower === 'income') return; // skip income lines

            const amt = Number(e.amount);
            if (!Number.isFinite(amt) || Number.isNaN(amt)) return;
            sums.set(name, (sums.get(name) || 0) + amt);
          });

        return Array.from(sums.entries())
          .map(([name, value]) => ({ name, value, color: colors.get(name) }))
          .sort((a, b) => b.value - a.value);
      })
    );
  }

  // Compute daily expense totals for a custom date range
  monthlyExpensesForRange(
    startDate: Date,
    endDate: Date
  ): Observable<NamedValue[]> {
    const startInclusive = startDate.getTime();
    const endExclusive = endDate.getTime();

    // Calculate number of days in the range
    const daysDiff = Math.ceil(
      (endExclusive - startInclusive) / (1000 * 60 * 60 * 24)
    );

    return this.expenses.getExpenses().pipe(
      map((resp) => {
        const expArr: Expense[] = Array.isArray(resp)
          ? (resp as Expense[])
          : (resp as any)?.data?.data || (resp as any)?.data || [];
        const daily = new Array<number>(daysDiff).fill(0);
        expArr
          .filter((e) => {
            const rawDate = e?.date || e?.createdAt;
            if (!rawDate) return false;
            const t = new Date(rawDate).getTime();
            return t >= startInclusive && t < endExclusive;
          })
          .forEach((e) => {
            // exclude income from daily expenses
            const cat = e.category;
            let type: string | undefined = undefined;
            if (cat && typeof cat === 'object') type = (cat as any).type;
            const typeLower = (type ?? '').toString().toLowerCase();
            if (typeLower === 'income') return;
            const amt = Number(e.amount);
            if (!Number.isFinite(amt) || Number.isNaN(amt)) return;
            const expenseDate = new Date(
              (e as any)?.date || (e as any)?.createdAt
            );
            const dayIndex = Math.floor(
              (expenseDate.getTime() - startInclusive) / (1000 * 60 * 60 * 24)
            );
            if (dayIndex >= 0 && dayIndex < daysDiff) daily[dayIndex] += amt;
          });
        return daily.map((v, i) => {
          const date = new Date(startInclusive + i * 24 * 60 * 60 * 1000);
          return { name: `${date.getDate()}/${date.getMonth() + 1}`, value: v };
        });
      })
    );
  }

  // Compute daily expense totals for a given month
  monthlyExpensesForMonth(
    month: number,
    year: number
  ): Observable<NamedValue[]> {
    const daysInMonth = new Date(year, month, 0).getDate();
    const startInclusive = new Date(year, month - 1, 1).getTime();
    const endExclusive = new Date(year, month, 1).getTime();
    return this.expenses.getExpenses().pipe(
      map((resp) => {
        const expArr: Expense[] = Array.isArray(resp)
          ? (resp as Expense[])
          : (resp as any)?.data?.data || (resp as any)?.data || [];
        const daily = new Array<number>(daysInMonth).fill(0);
        expArr
          .filter((e) => {
            const rawDate = e?.date || e?.createdAt;
            if (!rawDate) return false;
            const t = new Date(rawDate).getTime();
            return t >= startInclusive && t < endExclusive;
          })
          .forEach((e) => {
            // exclude income from daily expenses
            const cat = e.category;
            let type: string | undefined = undefined;
            if (cat && typeof cat === 'object') type = (cat as any).type;
            // If string id, we can't resolve type here cheaply; count as expense by default
            const typeLower = (type ?? '').toString().toLowerCase();
            if (typeLower === 'income') return;
            const amt = Number(e.amount);
            if (!Number.isFinite(amt) || Number.isNaN(amt)) return;
            const d = new Date(
              (e as any)?.date || (e as any)?.createdAt
            ).getDate();
            const idx = d - 1;
            if (idx >= 0 && idx < daysInMonth) daily[idx] += amt;
          });
        return daily.map((v, i) => ({ name: String(i + 1), value: v }));
      })
    );
  }

  // Helper: compute totals by scanning expenses when API totals are unavailable
  private computeTotalsFromExpenses(
    startDate: Date,
    endDate: Date
  ): Observable<{ income: number; expenses: number; balance: number }> {
    const startInclusive = startDate.getTime();
    const endInclusive = endDate.getTime();
    return this.expenses.getExpenses().pipe(
      map((resp) => {
        const expArr: Expense[] = Array.isArray(resp)
          ? (resp as Expense[])
          : (resp as any)?.data?.data || (resp as any)?.data || [];
        let income = 0;
        let expenses = 0;
        for (const e of expArr) {
          const rawDate = (e as any)?.date || (e as any)?.createdAt;
          if (!rawDate) continue;
          const t = new Date(rawDate).getTime();
          if (t < startInclusive || t > endInclusive) continue;
          let type: string | undefined;
          const cat = e.category as any;
          if (cat && typeof cat === 'object') type = cat.type;
          const typeLower = (type ?? '').toString().toLowerCase();
          const amt = Number(e.amount);
          if (!Number.isFinite(amt) || Number.isNaN(amt)) continue;
          if (typeLower === 'income') income += amt;
          else expenses += amt;
        }
        return { income, expenses, balance: income - expenses };
      })
    );
  }
}
