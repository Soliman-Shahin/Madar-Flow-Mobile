import { expenseSyncLabel } from 'src/app/shared/utils/expense-presentation';
import { ExpenseDetailComponent } from 'src/app/home/components/expense-detail/expense-detail.component';
import { CommonModule } from '@angular/common';
import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewEncapsulation,
  inject,
  Output,
  EventEmitter,
} from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import {
  BehaviorSubject,
  Subject,
  switchMap,
  takeUntil,
  debounceTime,
  catchError,
  EMPTY,
} from 'rxjs';
import { Expense } from 'src/app/shared/models/expense.model';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { ExpenseFormComponent } from '../expense-form/expense-form.component';
import { SkeletonBlockComponent } from 'src/app/shared/ui/skeleton-block/skeleton-block.component';
import { AmountComponent } from 'src/app/shared/ui/amount/amount.component';
import { ComponentStateService } from 'src/app/shared/services/component-state.service';
import { ExpenseService } from 'src/app/core/services/expense.service';
import { CategoryService } from 'src/app/modules/categories/services/categories.service';
import { AlertService } from 'src/app/shared/services/alert.service';
import { ToastService } from 'src/app/shared/services/toast.service';
import { TranslateService } from '@ngx-translate/core';

@Component({
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    TranslateModule,
    SkeletonBlockComponent,
    AmountComponent,
  ],
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsComponent implements OnChanges, OnDestroy {
  readonly syncLabel = expenseSyncLabel;
  @Input() limit: number = 5;
  @Input() month?: number;
  @Input() year?: number;
  @Output() dataChanged = new EventEmitter<void>();

  // ─── Public state for template ───────────────────────
  userCurrency = '';
  txLoading = false;
  loadError: string | null = null;
  transactions: Expense[] = [];
  categories: any[] = [];

  // ─── Private ─────────────────────────────────────────
  private isOpeningModal = false;
  private readonly destroy$ = new Subject<void>();
  private readonly refreshTrigger$ = new BehaviorSubject<void>(undefined);
  private readonly params$ = new BehaviorSubject<{
    month?: number;
    year?: number;
    limit: number;
  }>({ month: this.month, year: this.year, limit: this.limit });

  // ─── Injected services ───────────────────────────────
  private readonly expenseSvc = inject(ExpenseService);
  private readonly modalCtrl = inject(ModalController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly alertService = inject(AlertService);
  private readonly toastService = inject(ToastService);
  private readonly translateService = inject(TranslateService);

  private readonly profileService = inject(ProfileService);
  private readonly categoryService = inject(CategoryService);

  constructor() {
    // Load user currency
    this.loadUserCurrency();

    // Load categories
    this.loadCategories();

    // Single subscription: params change → debounce → HTTP call (only ONE call per change)
    this.params$
      .pipe(
        // Merge refresh trigger with params
        switchMap((params) =>
          this.refreshTrigger$.pipe(
            debounceTime(50), // prevent double-fire from combineLatest
            switchMap(() => {
              this.txLoading = true;
              this.loadUserCurrency();
              this.loadError = null;
              this.cdr.markForCheck();

              const queryParams: any = {};
              if (params.month && params.year) {
                queryParams.startDate = new Date(
                  params.year,
                  params.month - 1,
                  1
                ).toISOString();
                queryParams.endDate = new Date(
                  params.year,
                  params.month,
                  0,
                  23,
                  59,
                  59,
                  999
                ).toISOString();
              }
              if (params.limit) queryParams.limit = params.limit;

              return this.expenseSvc.getExpenses(queryParams, true).pipe(
                catchError(() => {
                  this.loadError = 'Failed to load transactions';
                  this.txLoading = false;
                  this.cdr.markForCheck();
                  return EMPTY;
                })
              );
            })
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (resp) => {
          const arr: Expense[] = Array.isArray(resp)
            ? resp
            : (resp as any)?.data?.data || (resp as any)?.data || [];

          arr.sort((a, b) => {
            const da = new Date(
              (a as any)?.date || (a as any)?.createdAt || 0
            ).getTime();
            const db = new Date(
              (b as any)?.date || (b as any)?.createdAt || 0
            ).getTime();
            return db - da;
          });

          this.transactions = arr.slice(
            0,
            Math.max(0, this.params$.value.limit || 5)
          );
          this.txLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loadError = 'Failed to load transactions';
          this.txLoading = false;
          this.cdr.markForCheck();
        },
      });

    this.expenseSvc.expenseReconciled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refreshTransactions());
  }

  get locale(): string {
    return this.translateService.currentLang || 'en';
  }

  loadUserCurrency() {
    this.userCurrency = this.profileService.getProfile()?.currency || '';
  }

  loadCategories() {
    this.categoryService
      .getCategories({ skip: 0, limit: 100, sort: 'createdAt' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const arr = Array.isArray(response)
            ? response
            : (response as any)?.data?.data || (response as any)?.data || [];
          this.categories = arr;
          this.cdr.markForCheck();
        },
        error: () => undefined,
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['month'] || changes['year'] || changes['limit']) {
      this.params$.next({
        month: this.month,
        year: this.year,
        limit: this.limit,
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refreshTransactions(): void {
    this.refreshTrigger$.next();
  }

  trackById(_: number, item: Expense) {
    return (item as any)?._id || (item as any)?.id || item;
  }

  getOperationName(t: Expense): string {
    return (
      (t as any)?.description || (t as any)?.title || (t as any)?.name || '—'
    );
  }

  private resolveCategory(t: Expense): any {
    let cat = (t as any)?.category;
    if (typeof cat === 'string') {
      const found = this.categories.find((c) => c._id === cat);
      if (found) return found;
    }
    return cat;
  }

  getCategoryName(t: Expense): string {
    const cat = this.resolveCategory(t);
    if (!cat || typeof cat === 'string') return '—';
    return (cat as any)?.title || (cat as any)?.name || '—';
  }

  getCategoryIcon(t: Expense): string {
    const cat = this.resolveCategory(t);
    if (!cat || typeof cat === 'string') return 'pricetag-outline';
    if (cat.icon) return cat.icon;
    return cat.type === 'income'
      ? 'arrow-down-circle-outline'
      : 'arrow-up-circle-outline';
  }

  getCategoryColor(t: Expense): string {
    const cat = this.resolveCategory(t);
    if (!cat || typeof cat === 'string') return '#ccc';
    return typeof cat.color === 'string' && cat.color ? cat.color : '#ccc';
  }

  getDateValue(t: Expense) {
    return (t as any)?.date ?? (t as any)?.createdAt;
  }

  getAmountValue(t: Expense): number {
    const n = Number((t as any)?.amount);
    return isNaN(n) ? 0 : n;
  }

  getCategoryType(t: Expense): 'income' | 'outcome' {
    const cat = this.resolveCategory(t);
    const catType = (cat as any)?.type;
    const expType = (t as any)?.type;
    return catType === 'income' || expType === 'income' ? 'income' : 'outcome';
  }

  isPopoverOpen(id: string): boolean {
    return false; // Simplified
  }

  async onDetail(item: Expense) {
    if (this.isOpeningModal) return;
    this.isOpeningModal = true;
    let role: string | undefined;
    try {
      const modal = await this.modalCtrl.create({
        component: ExpenseDetailComponent,
        componentProps: {
          expense: item,
          categoryName: this.getCategoryName(item),
          currency: this.userCurrency,
          locale: this.locale,
        },
        cssClass: 'main-modal expense-record-modal',
      });
      await modal.present();
      role = (await modal.onDidDismiss()).role;
    } finally {
      this.isOpeningModal = false;
    }
    if (role === 'edit') await this.onEdit(item);
  }

  async onEdit(item: Expense) {
    if (this.isOpeningModal) return;
    this.isOpeningModal = true;
    try {
      const modal = await this.modalCtrl.create({
        component: ExpenseFormComponent,
        componentProps: { expense: item },
      });
      await modal.present();
      const { role } = await modal.onDidDismiss();
      if (role === 'confirm' || role === 'delete') {
        this.refreshTransactions();
        this.dataChanged.emit();
      }
    } finally {
      this.isOpeningModal = false;
    }
  }

  async onDelete(item: Expense) {
    const name = this.getOperationName(item);
    await this.alertService.showDeleteConfirm(name, async () => {
      this.expenseSvc.deleteExpense((item as any)._id).subscribe({
        next: () => {
          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('EXPENSE.DELETE_SUCCESS')
          );
          this.refreshTransactions();
          this.dataChanged.emit();
        },
        error: () => {
          this.toastService.presentErrorToast(
            'bottom',
            this.translateService.instant('EXPENSE.DELETE_ERROR')
          );
        },
      });
    });
  }
}
