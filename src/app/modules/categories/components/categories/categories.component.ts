import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  ViewChild,
} from '@angular/core';
import {
  ActionSheetController,
  InfiniteScrollCustomEvent,
  IonSearchbar,
  ItemReorderEventDetail,
  RefresherCustomEvent,
  IonicModule,
} from '@ionic/angular';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  finalize,
  of,
  merge,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { BaseListComponent } from 'src/app/shared/base';
import { Category, CategoryParams } from '../../models';
import { SkeletonBlockComponent } from '../../../../shared/ui/skeleton-block/skeleton-block.component';
import { AsyncPipe } from '@angular/common';
import { PlanService } from '../../../../core/services/plan.service';
import { PlanLimitBannerComponent } from '../../../../shared/components/plan-limit-banner/plan-limit-banner.component';
import { ExpenseService } from 'src/app/core/services/expense.service';

@Component({
  selector: 'app-categories',
  templateUrl: './categories.component.html',
  styleUrls: ['./categories.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    IonicModule,
    SkeletonBlockComponent,
    AsyncPipe,
    TranslateModule,
    PlanLimitBannerComponent,
  ],
})
export class CategoriesComponent
  extends BaseListComponent<Category>
  implements OnInit
{
  private actionSheetController = inject(ActionSheetController);
  private translate = inject(TranslateService);
  private planService = inject(PlanService);
  private categoryExpenseService = inject(ExpenseService);

  private readonly loading = new BehaviorSubject<boolean>(false);
  private readonly errorMessage = new BehaviorSubject<string>('');
  private readonly usageRefresh = new BehaviorSubject<void>(undefined);
  readonly usageCounts$ = new BehaviorSubject<Record<string, number>>({});

  readonly vm$ = combineLatest({
    response: this.response$,
    isLoading: this.loading.asObservable(),
    errorMessage: this.errorMessage.asObservable(),
  });

  sizeOptions = {
    pageSizeOptions: this.pageSizeOptions,
    pageSize: this.pageSize,
  };

  sortOptions = {
    sortBy: 'order',
  };

  readonly #defaultParams: CategoryParams = {
    skip: 0,
    limit: this.pageSize,
    sort: this.sortOptions?.sortBy as string,
  };

  readonly #paramsSub = new BehaviorSubject<CategoryParams>({
    ...this.#defaultParams,
  });

  get activatedParams() {
    return this.#paramsSub.getValue();
  }

  isActionSheetOpen = false;
  selectedCategory: Category | null = null;
  searchQuery = '';
  activeType: 'all' | 'income' | 'outcome' = 'all';

  @ViewChild('categorySearch') categorySearch?: IonSearchbar;

  // Plan Limits State
  canAddCategory = true;
  categoriesLimitInfo = { used: 0, limit: 0 as number | null, percentage: 0 };

  constructor() {
    super();
  }

  override ngOnInit() {
    this.setupSubscription();
    this.setupUsageCounts();
    this.checkPlanLimits();
  }

  private hasEntered = false;

  ionViewWillEnter() {
    this.checkPlanLimits();
    if (this.hasEntered) {
      // Force a refresh by re-emitting the current params
      const currentParams = this.#paramsSub.getValue();
      this.#paramsSub.next({ ...currentParams });
      this.usageRefresh.next();
    }
    this.hasEntered = true;
  }

  private setupUsageCounts(): void {
    merge(this.usageRefresh, this.categoryExpenseService.expenseReconciled$)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() =>
          this.categoryExpenseService
            .getCategoryUsageCounts()
            .pipe(catchError(() => of({} as Record<string, number>)))
        )
      )
      .subscribe((counts) => {
        this.usageCounts$.next(counts);
        this.cdr.markForCheck();
      });
  }

  usageCount(categoryId: string | undefined): number {
    return this.usageCounts$.value[String(categoryId ?? '')] || 0;
  }

  usageLabelKey(count: number): string {
    return count === 1
      ? 'CATEGORIES.USAGE_ONE'
      : count === 2
      ? 'CATEGORIES.USAGE_TWO'
      : 'CATEGORIES.USAGE_OTHER';
  }

  private checkPlanLimits() {
    this.planService.currentPlan$
      .pipe(takeUntil(this.destroy$))
      .subscribe((planData) => {
        if (planData) {
          this.canAddCategory = this.planService.canAddCategory();
          this.categoriesLimitInfo = planData.usage.categories;
          this.cdr.markForCheck();
        }
      });
  }

  private setupSubscription() {
    this.#paramsSub
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.loading.next(true);
          this.errorMessage.next('');
        }),
        switchMap((params) =>
          this.categoryService.getCategories(params, true).pipe(
            // forceRefresh = true
            finalize(() => this.loading.next(false)),
            catchError((err) => {
              this.errorMessage.next('COMMON.ERRORS.LOAD_DATA');
              return of(null);
            })
          )
        )
      )
      .subscribe((res: any) => {
        if (res) {
          const currentResponse = this._responseSub.getValue();
          const params = this.#paramsSub.getValue();
          // If it's the first page (or a filter was applied), replace the data
          if (params.skip === 0 || !currentResponse) {
            this._responseSub.next(res);
          } else {
            // Otherwise, append the new data for infinite scroll
            this._responseSub.next({
              ...currentResponse, // Keep current response metadata (like total)
              data: [...currentResponse.data, ...res.data], // Merge only the data arrays
            });
          }
        }
      });
  }

  onIonInfinite(ev: InfiniteScrollCustomEvent) {
    this.loadMoreCategories();
    setTimeout(() => {
      ev.target.complete();
    }, 500);
  }

  loadMoreCategories() {
    if (this.loading.getValue()) return; // Prevent multiple requests

    const currentParams = this.#paramsSub.getValue();
    const nextParams = {
      ...currentParams,
      skip: currentParams.skip + currentParams.limit,
    };
    this.#paramsSub.next(nextParams);
  }

  doRefresh(ev: RefresherCustomEvent) {
    // Reset pagination and filters to their default state
    this.#paramsSub.next(this.#defaultParams);
    setTimeout(() => ev.target.complete(), 600);
  }

  navigateToAdd() {
    if (!this.canAddCategory) {
      this.router.navigate(['/subscription'], {
        queryParams: {
          reason: 'limit_reached',
          limitType: 'SUBSCRIPTION.CATEGORIES_LIMIT',
        },
      });
      return;
    }
    this.router.navigate(['/categories/create']);
  }

  /** Reordering is an explicit mode so rows show one affordance at a time. */
  reorderMode = false;

  toggleReorder(): void {
    this.reorderMode = !this.reorderMode;
    this.cdr.markForCheck();
  }

  handleReorder(ev: CustomEvent<ItemReorderEventDetail>) {
    const currentResponse = this._responseSub.getValue();
    if (currentResponse) {
      const movedItem = currentResponse.data.splice(ev.detail.from, 1)[0];
      currentResponse.data.splice(ev.detail.to, 0, movedItem);
      // Use 'categoryId' instead of 'id' to avoid the HTTP encryption interceptor
      // from double-encrypting the MongoDB ObjectId (interceptor encrypts fields
      // named 'id' and '_id', causing a key mismatch error on the backend)
      const reorderedCategories = currentResponse.data.map(
        (category, index) => ({
          categoryId: category._id as string,
          order: index,
        })
      );
      this.categoryService.updateOrder(reorderedCategories).subscribe();
      this._responseSub.next({ ...currentResponse });
    }
    ev.detail.complete();
  }

  async presentActionSheet(category: Category) {
    this.selectedCategory = category;
    const selectedId = category._id as string;
    const actionSheet = await this.actionSheetController.create({
      header: this.translateService.instant('MOBILE_UI.CATEGORY_ACTIONS'),
      buttons: [
        {
          text: this.translateService.instant('CATEGORY.EDIT'),
          icon: 'create-outline',
          handler: () => this.router.navigate(['/categories/edit', selectedId]),
        },
        {
          text: this.translateService.instant('COMMON.DELETE'),
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            setTimeout(() => void this.presentDeleteConfirm(selectedId));
          },
        },
        {
          text: this.translateService.instant('COMMON.CANCEL'),
          role: 'cancel',
        },
      ],
    });

    await actionSheet.present();
  }

  async presentDeleteConfirm(id: string) {
    const categoryName = this.selectedCategory?.title || '';
    await this.alertService.showDeleteConfirm(categoryName, async () => {
      this.deleteCategory(id);
    });
  }

  deleteCategory(id: string) {
    if (this.loading.getValue()) return;
    this.loading.next(true);
    this.errorMessage.next('');
    this.categoryService
      .deleteCategory(id)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.next(false)),
        catchError((err) => {
          this.errorMessage.next('COMMON.ERRORS.DEFAULT');
          return of(null);
        })
      )
      .subscribe((result) => {
        if (result !== null) {
          const currentResponse = this._responseSub.getValue();
          if (currentResponse) {
            const filteredData = currentResponse.data.filter(
              (c) => c._id !== id
            );
            const newTotal = currentResponse.total - 1;
            this._responseSub.next({
              ...currentResponse,
              data: filteredData,
              total: newTotal,
            });
            this.toastService.presentSuccessToast(
              'bottom',
              this.translateService.instant('CATEGORY.SUCCESSFULLY_DELETED')
            );
          }
        }
      });
  }

  filter(event: any) {
    const query = String(event.target.value ?? '')
      .trim()
      .toLowerCase();
    this.searchQuery = query;
    const currentParams = this.#paramsSub.getValue();
    this.#paramsSub.next({
      ...currentParams,
      skip: 0,
      q: query,
    });
  }

  filterByType(event: any) {
    const type = event.detail.value;
    this.activeType = type === 'all' ? 'all' : type;
    const currentParams = this.#paramsSub.getValue();
    this.#paramsSub.next({
      ...currentParams,
      skip: 0,
      type: type === 'all' ? undefined : type,
    });
  }

  hasActiveFilters(): boolean {
    return !!this.searchQuery || this.activeType !== 'all';
  }

  clearFilters(): void {
    if (!this.hasActiveFilters()) return;
    if (this.categorySearch) {
      this.categorySearch.value = '';
      void this.categorySearch.getInputElement().then((input) => {
        input.value = '';
      });
    }
    this.searchQuery = '';
    this.activeType = 'all';
    this.#paramsSub.next({ ...this.#defaultParams });
  }

  setOpen(isOpen: boolean) {
    this.isActionSheetOpen = isOpen;
  }
}
