import { animate, style, transition, trigger } from '@angular/animations';
import { ledgerFormSheet } from 'src/app/shared/ui/sheet/sheet-options';
import { createInjectors } from './create-injectors';
import {
  Injector,
  inject,
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Observable, defer } from 'rxjs';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { AlertController, IonicModule } from '@ionic/angular';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { SUPPORTED_CURRENCIES } from 'src/app/shared/utils';
import { SyncStatusComponent } from 'src/app/shared/components/sync-status/sync-status.component';
import { TranslateModule } from '@ngx-translate/core';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  forkJoin,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { ExpenseFormComponent } from '../expense-form/expense-form.component';
import { TransactionsComponent } from '../transactions/transactions.component';
import { ReactiveFormsModule } from '@angular/forms';
import { formatCurrency } from 'src/app/shared/utils';
import { MonthYear } from '../../models';
import {
  DateRange,
  DateRangeSelectorComponent,
} from 'src/app/shared/components/ui/date-range-selector/date-range-selector.component';
import { BaseComponent } from 'src/app/shared/base';
import { SkeletonBlockComponent } from 'src/app/shared/ui';
import { User } from 'src/app/modules/auth/models';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { DashboardFacade } from 'src/app/shared/facades';
import { Expense } from 'src/app/shared/models';
import { MonthHeroComponent } from '../month-hero/month-hero.component';
import { AmountComponent } from 'src/app/shared/ui/amount/amount.component';
import { QuickAddService } from 'src/app/shared/services/quick-add.service';
import { MonthsScrollHeaderComponent } from 'src/app/shared/components/months-scroll-header/months-scroll-header.component';
import { ExpenseService } from 'src/app/core/services/expense.service';

@Component({
  standalone: true,
  selector: 'app-home-page',
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.scss'],
  imports: [
    CommonModule,
    RouterModule,
    IonicModule,

    ReactiveFormsModule,
    TranslateModule,
    TransactionsComponent,
    DateRangeSelectorComponent,
    SkeletonBlockComponent,
    MonthHeroComponent,
    AmountComponent,
    MonthsScrollHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('tabAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate(
          '300ms ease-out',
          style({ opacity: 1, transform: 'translateY(0)' })
        ),
      ]),
    ]),
  ],
})
export class HomePageComponent
  extends BaseComponent
  implements OnInit, OnDestroy
{
  // Lazy-loaded chart component references
  barChartComponent: Observable<any> = defer(() =>
    import(
      'src/app/shared/components/charts/bar-chart/bar-chart.component'
    ).then((m) => m.BarChartComponent)
  );
  pieChartComponent: Observable<any> = defer(() =>
    import(
      'src/app/shared/components/charts/pie-chart/pie-chart.component'
    ).then((m) => m.PieChartComponent)
  );
  lineChartComponent: Observable<any> = defer(() =>
    import(
      'src/app/shared/components/charts/line-chart/line-chart.component'
    ).then((m) => m.LineChartComponent)
  );

  private _injector = inject(Injector);

  barChartInjector!: Injector;
  pieChartInjector!: Injector;
  lineChartInjector!: Injector;
  salaryBreakdownPieChartInjector!: Injector;

  latestVm: any;
  hasRenderedHomeContent = false;

  // Subscribe to vm$ for latest values (for injectors)
  // (Removed duplicate ngOnInit here)

  @ViewChild('transactionsComponent')
  transactionsComponent?: TransactionsComponent;
  selectedMonth: MonthYear = this.getCurrentMonthYear();
  currentDate: Date = new Date();
  // Keep simple fallbacks where needed
  percentageChange: number | null = null;
  selectedRange: DateRange = '1m';
  currency = '';

  // UI state
  activeTab: 'charts' | 'summary' = 'summary';
  isChartsScrolling = false;

  // Scroll position state
  isScrolledToStart = true;
  isScrolledToEnd = false;

  // Header configuration
  private headerConfig = {
    title: 'HOME.TITLE',
    icon: 'home-outline',
  };

  // Card interaction states
  cardStates: { [key: string]: boolean } = {
    balance: false,
    income: false,
    expenses: false,
    salary: false,
    quickActions: false,
    monthlySummary: false,
    recentTransactions: false,
  };

  // Privacy: hide amounts on the hero (remembered per device).
  amountsMasked = false;
  private readonly quickAdd = inject(QuickAddService);
  private readonly alertController = inject(AlertController);
  private readonly profileData = inject(ProfileService);
  /** Asked at most once per app session; "Later" must not nag on every home visit. */
  private static currencyPromptShown = false;
  private unregisterQuickAdd?: () => void;

  constructor() {
    super();
  }

  get isSelectedMonthCurrent(): boolean {
    const now = new Date();
    return (
      this.selectedMonth.year === now.getFullYear() &&
      this.selectedMonth.month === now.getMonth() + 1
    );
  }

  get selectedMonthLabel(): string {
    return new Intl.DateTimeFormat(this.currentLang || 'en', {
      month: 'long',
      year: 'numeric',
      numberingSystem: 'latn',
    }).format(
      new Date(this.selectedMonth.year, this.selectedMonth.month - 1, 1)
    );
  }

  setAmountsMasked(masked: boolean): void {
    this.amountsMasked = masked;
    try {
      localStorage.setItem('home.amountsMasked', masked ? '1' : '0');
    } catch {}
    this.cdr.markForCheck();
  }

  // Reactive month selection for Summary tab (current month only)
  private readonly summaryMonthSelection$ = new BehaviorSubject<MonthYear>(
    this.selectedMonth
  );
  private readonly summaryRefresh$ = new BehaviorSubject<number>(0);
  summaryError: string | null = null;
  chartsError: string | null = null;

  // Reactive month selection for Charts tab (supports custom date ranges)
  private readonly chartsMonthSelection$ = new BehaviorSubject<MonthYear>({
    ...this.selectedMonth,
    ...this.getChartsDateRange(this.selectedMonth, this.selectedRange),
  });

  private readonly dashboard = inject(DashboardFacade);
  private readonly homeExpenseService = inject(ExpenseService);

  createInjectors = createInjectors;

  // Auth state for UI
  protected override readonly authService = inject(AuthService);

  private readonly dashboardProfile$ = this.authService.user$.pipe(
    switchMap((user) => {
      if (!user) {
        return of(null);
      }
      return this.dashboard.profile$.pipe(
        switchMap((profile) => {
          if (!this.authService.isLoggedIn) return of(null);
          if (profile) {
            return of(profile);
          }
          return this.dashboard.profile
            .fetchProfile()
            .pipe(catchError(() => of(null)));
        })
      );
    }),
    takeUntil(this.destroy$),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // Totals for Summary tab (always current month)
  private readonly totalsByMonth$ = combineLatest([
    this.summaryMonthSelection$,
    this.dashboardProfile$,
    this.summaryRefresh$,
  ]).pipe(
    switchMap(([month, profile]) => {
      if (!profile) {
        return of({ income: 0, expenses: 0, balance: 0 });
      }

      // Summary tab always uses month/year (no custom ranges)
      const totals$ = this.dashboard.totalsForMonth(month.month, month.year);

      return totals$.pipe(
        map((totals) => {
          const base = totals ?? { income: 0, expenses: 0, balance: 0 };
          const result = this.dashboard.withProfileIncome(base, profile);
          return result;
        }),
        tap(() => (this.summaryError = null)),
        catchError(() => {
          this.summaryError = 'HOME.WIDGET_UNAVAILABLE';
          return of(null);
        })
      );
    }),
    catchError(() => {
      this.summaryError = 'HOME.WIDGET_UNAVAILABLE';
      return of(null);
    }),
    shareReplay(1)
  );

  private readonly expenseComparisonByMonth$ = combineLatest([
    this.summaryMonthSelection$,
    this.dashboardProfile$,
    this.summaryRefresh$,
  ]).pipe(
    switchMap(([month, profile]) => {
      if (!profile) return of({ status: 'unavailable' as const });
      return this.dashboard
        .expenseComparisonForMonth(month.month, month.year)
        .pipe(
          map((comparison) => ({ status: 'ready' as const, ...comparison })),
          catchError(() => of({ status: 'unavailable' as const }))
        );
    }),
    startWith({ status: 'loading' as const }),
    shareReplay(1)
  );

  // Totals for Charts tab (supports custom date ranges)
  private readonly totalsByCharts$ = combineLatest([
    this.chartsMonthSelection$,
    this.dashboardProfile$,
  ]).pipe(
    switchMap(([month, profile]) => {
      if (!profile) {
        return of({ income: 0, expenses: 0, balance: 0 });
      }

      // Use custom date range if provided, otherwise use month/year
      const startDate =
        month.startDate && month.endDate
          ? new Date(month.startDate)
          : new Date(month.year, month.month - 1, 1);
      const endDate =
        month.startDate && month.endDate
          ? new Date(month.endDate)
          : new Date(month.year, month.month, 1);

      return forkJoin({
        totals: this.dashboard.totalsForRange(startDate, endDate),
        income: this.dashboard.incomeTransactionsForRange(startDate, endDate),
      })
        .pipe(
          map(({ totals, income }) => {
            const base = {
              income: income.sum,
              expenses: Number(totals?.expenses ?? 0),
              balance: income.sum - Number(totals?.expenses ?? 0),
            };
            return this.dashboard.withProfileIncome(base, profile);
          })
        )
        .pipe(
          tap(() => (this.chartsError = null)),
          catchError(() => {
            this.chartsError = 'HOME.WIDGET_UNAVAILABLE';
            return of(null);
          })
        );
    }),
    catchError(() => {
      this.chartsError = 'HOME.WIDGET_UNAVAILABLE';
      return of(null);
    }),
    shareReplay(1)
  );

  private readonly expenseByCategoryByMonth$ = combineLatest([
    this.chartsMonthSelection$,
    this.dashboardProfile$,
  ]).pipe(
    switchMap(([m, profile]) => {
      if (!profile) {
        return of([]);
      }
      // Use custom date range if provided
      if (m.startDate && m.endDate) {
        return this.dashboard.expenseByCategoryForRange(
          new Date(m.startDate),
          new Date(m.endDate)
        );
      }
      return this.dashboard.expenseByCategoryForMonth(m.month, m.year);
    }),
    catchError(() => of([])),
    startWith([])
  );

  private readonly monthlyExpensesByMonth$ = combineLatest([
    this.chartsMonthSelection$,
    this.dashboardProfile$,
  ]).pipe(
    switchMap(([m, profile]) => {
      if (!profile) {
        return of([]);
      }
      // Use custom date range if provided
      if (m.startDate && m.endDate) {
        return this.dashboard.monthlyExpensesForRange(
          new Date(m.startDate),
          new Date(m.endDate)
        );
      }
      return this.dashboard.monthlyExpensesForMonth(m.month, m.year);
    }),
    catchError(() => of([])),
    startWith([])
  );
  // Derive income vs expenses for Charts tab from totalsByCharts$
  private readonly incomeVsExpenseByMonth$ = combineLatest([
    this.totalsByCharts$,
    this.translateService.onLangChange.pipe(
      startWith({ lang: this.translateService.currentLang })
    ),
  ]).pipe(
    map(([t, langEvent]) => {
      if (!t) return [];
      return [
        {
          name: 'HOME.INCOME',
          value: t.income,
        },
        {
          name: 'HOME.EXPENSES',
          value: t.expenses,
        },
      ];
    })
  );

  readonly vm$ = combineLatest({
    loading: toObservable(this.state.loading),
    profile: this.dashboardProfile$.pipe(startWith(null)),
    totals: this.totalsByMonth$,
    expenseComparison: this.expenseComparisonByMonth$,
    incomeVsExpense: this.incomeVsExpenseByMonth$,
    expenseByCategory: this.expenseByCategoryByMonth$,
    monthlyExpenses: this.monthlyExpensesByMonth$,
  }).pipe(
    map((data) => {
      const salaryDetails = Array.isArray(data.profile?.salary)
        ? data.profile.salary
        : [];
      const totalSalary = salaryDetails.reduce(
        (sum, item) => sum + (Number(item?.amount) || 0),
        0
      );
      const salaryBreakdown = salaryDetails.map((item) => ({
        name: item.label,
        value: item.amount,
        percentage: totalSalary > 0 ? (item.amount || 0) / totalSalary : 0,
      }));

      return {
        ...data,
        salaryDetails,
        totalSalary,
        salaryBreakdown,
        currency: data.profile?.currency || '',
        chartSummaries: this.buildChartSummaries(
          { ...data, salaryBreakdown },
          data.profile?.currency || ''
        ),
      };
    }),
    shareReplay(1)
  );

  // trackBy helpers
  trackByIndex(index: number): number {
    return index;
  }

  formatAmount(amount: number | null | undefined): string {
    return formatCurrency(amount ?? 0, this.currency);
  }

  private buildChartSummaries(data: any, currency: string) {
    const format = (value: number) =>
      formatCurrency(value, currency, this.currentLang);
    const incomeExpense = (data.incomeVsExpense || []) as Array<{
      name: string;
      value: number;
    }>;
    const income =
      incomeExpense.find((item) => item.name === 'HOME.INCOME')?.value ?? 0;
    const expenses =
      incomeExpense.find((item) => item.name === 'HOME.EXPENSES')?.value ?? 0;
    const categoryData = (data.expenseByCategory || []) as Array<{
      name: string;
      value: number;
    }>;
    const categoryTotal = categoryData.reduce(
      (sum, item) => sum + Number(item.value || 0),
      0
    );
    const topCategory = categoryData.reduce<{
      name: string;
      value: number;
    } | null>(
      (top, item) =>
        top === null || Number(item.value) > top.value ? item : top,
      null
    );
    const trendData = (data.monthlyExpenses || []) as Array<{
      name: string;
      value: number;
    }>;
    const highestPoint = trendData.reduce<{
      name: string;
      value: number;
    } | null>(
      (highest, item) =>
        highest === null || Number(item.value) > highest.value ? item : highest,
      null
    );
    const lowestPoint = trendData.reduce<{
      name: string;
      value: number;
    } | null>(
      (lowest, item) =>
        lowest === null || Number(item.value) < lowest.value ? item : lowest,
      null
    );
    const firstPoint = trendData[0];
    const lastPoint = trendData[trendData.length - 1];
    const trendDirection =
      trendData.length < 2 || !firstPoint || !lastPoint
        ? 'single'
        : lastPoint.value > firstPoint.value
        ? 'increase'
        : lastPoint.value < firstPoint.value
        ? 'decrease'
        : 'same';
    const salaryData = (data.salaryBreakdown || []) as Array<{
      name: string;
      value: number;
    }>;
    const salaryTotal = salaryData.reduce(
      (sum, item) => sum + Number(item.value || 0),
      0
    );
    const topSalary = salaryData.reduce<{ name: string; value: number } | null>(
      (top, item) =>
        top === null || Number(item.value) > top.value ? item : top,
      null
    );
    return {
      incomeExpense: incomeExpense.length
        ? { income: format(income), expenses: format(expenses) }
        : null,
      category: topCategory
        ? {
            total: format(categoryTotal),
            topName: topCategory.name,
            topAmount: format(topCategory.value),
            topShare:
              categoryTotal > 0
                ? String(Math.round((topCategory.value / categoryTotal) * 100))
                : '0',
          }
        : null,
      trend:
        highestPoint && lowestPoint
          ? {
              kind: trendDirection,
              highestName: highestPoint.name,
              highestValue: format(highestPoint.value),
              lowestName: lowestPoint.name,
              lowestValue: format(lowestPoint.value),
            }
          : null,
      salary: topSalary
        ? {
            total: format(salaryTotal),
            topName: topSalary.name,
            topAmount: format(topSalary.value),
            topShare:
              salaryTotal > 0
                ? String(Math.round((topSalary.value / salaryTotal) * 100))
                : '0',
          }
        : null,
    };
  }

  // Switch between Charts and Summary tabs
  setActiveTab(tab: string | number | null | undefined) {
    // Normalize to a valid key; default to 'charts'
    const val = tab != null ? String(tab) : '';
    this.activeTab = val === 'summary' ? 'summary' : 'charts';
    // Active tab is now managed by the component state
    try {
      localStorage.setItem('home.activeTab', this.activeTab);
    } catch {}
    this.cdr.markForCheck();
  }

  get displayUsername(): string {
    return (
      this.user?.['username'] ||
      this.user?.['fullName'] ||
      this.translateService.instant('USER.DEFAULT_NAME')
    );
  }

  /**
   * Initializes the component with additional setup
   */
  /** An account with no currency (new, or created before currencies were required) is asked once. */
  private async promptForCurrency(profile: { currency?: string } | null): Promise<void> {
    if (!profile || profile.currency || HomePageComponent.currencyPromptShown) return;
    HomePageComponent.currencyPromptShown = true;
    const alert = await this.alertController.create({
      header: this.translateService.instant('MOBILE.CURRENCY_PROMPT_TITLE'),
      message: this.translateService.instant('MOBILE.CURRENCY_PROMPT_MESSAGE'),
      backdropDismiss: false,
      inputs: SUPPORTED_CURRENCIES.map((code, index) => ({
        type: 'radio' as const,
        label: code,
        value: code,
        checked: index === 0,
      })),
      buttons: [
        { text: this.translateService.instant('MOBILE.CURRENCY_PROMPT_LATER'), role: 'cancel' },
        {
          text: this.translateService.instant('COMMON.SAVE'),
          handler: (code: string) => {
            if (code) this.profileData.updateProfile({ currency: code }).subscribe();
          },
        },
      ],
    });
    await alert.present();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    this.vm$.pipe(takeUntil(this.destroy$)).subscribe((vm) => {
      this.latestVm = vm;
      if (vm.profile) {
        this.hasRenderedHomeContent = true;
        void this.promptForCurrency(vm.profile);
      }
      // vm.loading observes shared state; writing it back can replay stale
      // loading after logout/navigation clears the operation that owns it.
      this.createInjectors(vm);
      this.cdr.markForCheck();
    });
    try {
      this.amountsMasked = localStorage.getItem('home.amountsMasked') === '1';
    } catch {}
    this.destroy$.subscribe(() => this.unregisterQuickAdd?.());
    this.quickAdd.transactionSaved$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refreshData());
    // Restore last selected tab
    try {
      const savedTab = localStorage.getItem('home.activeTab');
      if (savedTab === 'summary' || savedTab === 'charts') {
        this.activeTab = savedTab;
      }
    } catch {}
    this.setupRouteDataSubscription();
    this.homeExpenseService.expenseReconciled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.summaryRefresh$.next(this.summaryRefresh$.value + 1);
        this.chartsMonthSelection$.next({
          ...this.chartsMonthSelection$.value,
        });
        this.cdr.markForCheck();
      });
  }

  private hasEntered = false;

  /**
   * Refresh data when returning to the page
   */
  ionViewWillEnter(): void {
    this.unregisterQuickAdd?.();
    this.unregisterQuickAdd = this.quickAdd.register(() =>
      this.openExpenseModal()
    );
    if (this.hasEntered) {
      this.refreshData();
    }
    this.hasEntered = true;
  }

  ionViewWillLeave(): void {
    this.unregisterQuickAdd?.();
    this.unregisterQuickAdd = undefined;
  }

  /**
   * Handles month change from the month selector
   */
  onMonthChange(monthYear: MonthYear): void {
    this.selectedMonth = monthYear;
    // Notify Summary tab stream only
    this.summaryMonthSelection$.next(monthYear);
    this.chartsMonthSelection$.next({
      ...monthYear,
      ...this.getChartsDateRange(monthYear, this.selectedRange),
    });
  }

  /**
   * Handles scroll events from the months scroll header
   */
  onMonthScroll(event: { isAtStart: boolean; isAtEnd: boolean }): void {
    this.isScrolledToStart = event.isAtStart;
    this.isScrolledToEnd = event.isAtEnd;
    this.cdr.markForCheck();
  }

  /**
   * Handles date range change from the selector
   */
  onRangeChange(range: DateRange): void {
    // Save the selected range so it persists when switching tabs
    this.selectedRange = range;

    const rangeDates = this.getChartsDateRange(this.selectedMonth, range);
    this.chartsMonthSelection$.next({
      ...this.selectedMonth,
      ...rangeDates,
    });

    this.cdr.markForCheck();
  }

  /**
   * Handles user data changes
   */
  protected override onUserChanged(user: User | null): void {
    super.onUserChanged(user);
    this.setError(null);
    this.cdr.markForCheck();
  }

  /**
   * Gets current month and year
   */
  private getCurrentMonthYear(): MonthYear {
    const now = new Date();
    return {
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    };
  }

  /**
   * Sets up subscription to route data changes
   */
  private setupRouteDataSubscription(): void {
    this.activatedRoute.data
      .pipe(
        takeUntil(this.destroy$),
        tap((data: any) => {
          this.headerConfig = { ...this.headerConfig, ...data };
        }),
        catchError((error: any) => {
          this.handleError('COMMON.ERRORS.LOAD_DATA', error, true);
          return of(null);
        })
      )
      .subscribe();
  }

  // Card interaction methods
  onCardHover(cardName: string, isHovering: boolean) {
    this.cardStates[cardName] = isHovering;
    this.cdr.markForCheck();
  }

  onCardClick(cardName: string) {
    // Add specific click behavior for each card if needed

    // Trigger a subtle animation
    this.cardStates[cardName] = true;
    setTimeout(() => (this.cardStates[cardName] = false), 150);
  }

  // Retry handler from template: re-emit current month to refresh streams
  retry(): void {
    this.retrySummary();
    this.retryCharts();
  }

  retrySummary(): void {
    this.summaryError = null;
    this.summaryMonthSelection$.next({ ...this.selectedMonth });
    this.cdr.markForCheck();
  }
  retryCharts(): void {
    this.chartsError = null;
    this.chartsMonthSelection$.next({
      ...this.chartsMonthSelection$.getValue(),
    });
    this.cdr.markForCheck();
  }

  private isOpeningModal = false;

  // FAB: open expense form modal
  async openExpenseModal(expense?: Expense): Promise<void> {
    if (this.isOpeningModal) return;
    this.isOpeningModal = true;
    try {
      const modal = await this.modalCtrl.create({
        component: ExpenseFormComponent,
        ...ledgerFormSheet(),
        componentProps: { expense, onClose: () => modal.dismiss() },
      });

      await modal.present();

      const result = await modal.onDidDismiss();
      if (result.role === 'confirm' || result.role === 'delete') {
        this.refreshData();
      }
    } catch (err: any) {
      this.handleError('COMMON.ERRORS.DEFAULT', err, true);
    } finally {
      this.isOpeningModal = false;
    }
  }

  // Refresh data method
  private refreshData(): void {
    // Explicitly invalidate the current-month totals without changing the
    // selected month or relying on same-value stream emissions.
    this.summaryRefresh$.next(this.summaryRefresh$.value + 1);
    // Also refresh charts with current selection
    const currentCharts = this.chartsMonthSelection$.getValue();
    this.chartsMonthSelection$.next({ ...currentCharts });

    // Also refresh transactions component if available
    if (this.transactionsComponent) {
      this.transactionsComponent.refreshTransactions();
    }

    this.cdr.markForCheck();
  }

  onHomeContentScroll(): void {
    if (this.activeTab === 'charts') {
      this.isChartsScrolling = true;
    }
  }

  onHomeContentScrollEnd(): void {
    this.isChartsScrolling = false;
  }

  private getChartsDateRange(
    anchor: MonthYear,
    range: DateRange
  ): { startDate: string; endDate: string } {
    const endDate = new Date(anchor.year, anchor.month, 0, 23, 59, 59, 999);
    const monthCount =
      range === '1m' ? 1 : range === '6m' ? 6 : range === '1y' ? 12 : 0;
    const startDate =
      monthCount > 0
        ? new Date(anchor.year, anchor.month - monthCount, 1, 0, 0, 0, 0)
        : new Date(0);
    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
  }

  refreshSummaryTotals(): void {
    this.summaryRefresh$.next(this.summaryRefresh$.value + 1);
    this.cdr.markForCheck();
  }

  onTransactionsDataChanged(): void {
    this.refreshSummaryTotals();
    const currentCharts = this.chartsMonthSelection$.getValue();
    this.chartsMonthSelection$.next({ ...currentCharts });
  }

  // Toggle language between Arabic and English
  toggleLanguage(): void {
    const newLang = this.currentLang === 'ar' ? 'en' : 'ar';
    this.translationService?.setLanguage(newLang);
    this.cdr.markForCheck();
  }
}
