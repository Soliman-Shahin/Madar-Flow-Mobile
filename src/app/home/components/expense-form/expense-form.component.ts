import { expenseSyncLabel } from 'src/app/shared/utils/expense-presentation';
import {
  AfterViewInit,
  Component,
  Input,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  FormGroup,
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
  Validators,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { Observable, combineLatest, BehaviorSubject } from 'rxjs';
import {
  map,
  debounceTime,
  distinctUntilChanged,
  finalize,
  takeUntil,
} from 'rxjs/operators';

import { BaseComponent } from 'src/app/shared/base/base.component';
import { Expense, Category } from 'src/app/shared/models';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { trapFocus, releaseFocus } from 'src/app/shared/utils/focus-trap';
import { IonicModule } from '@ionic/angular';
import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ExpenseDraftService } from 'src/app/core/services/expense-draft.service';

@Component({
  selector: 'app-expense-form',
  templateUrl: './expense-form.component.html',
  styleUrls: ['./expense-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    IonicModule,
    FormsModule,
    ReactiveFormsModule,
    AsyncPipe,
    DatePipe,
    NgTemplateOutlet,
    TranslateModule,
  ],
})
export class ExpenseFormComponent
  extends BaseComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  readonly syncLabel = expenseSyncLabel;
  @Input() expense?: Expense;
  @Input() onClose: () => void = () => {};

  @ViewChild('formContainer', { read: ElementRef })
  formContainerRef!: ElementRef<HTMLElement>;

  expenseForm!: FormGroup;
  isEditMode = false;
  // ion-datetime is date-based here. Use local noon so the calendar cannot
  // cross a UTC midnight and display/save the adjacent day.
  maxDate = this.localCalendarIso(new Date());
  userCurrency = '';

  allCategories: Category[] = [];
  filteredCategories: Category[] = [];
  favoriteCategories: Category[] = [];
  recentCategories: Category[] = [];
  remainingCategories: Category[] = [];
  showCategoryPopover = false;
  private typeSubject$ = new BehaviorSubject<'income' | 'outcome'>('outcome');
  private categoriesLoaded = false;
  private categoriesResolved = false;
  private initialized = false;
  private initialFormValue: Record<string, unknown> | null = null;
  isDeleteSubmitting = false;
  hasDraft = false;
  private readonly ownerId = this.tokenService.getUserId();
  private readonly shortcutStoragePrefix =
    'madarflow.transaction-category-shortcuts.v1.';
  private readonly recentCategoryCap = 5;
  private recentCategoryIds: string[] = [];
  private favoriteCategoryIds: string[] = [];

  vm$ = combineLatest([toObservable(this.state.loading)]).pipe(
    map(([isLoading]) => ({ isLoading }))
  );

  constructor(
    private profileService: ProfileService,
    private draftService: ExpenseDraftService
  ) {
    super();
  }

  override ngOnInit() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    super.ngOnInit();
    this.isEditMode = !!this.expense;
    this.userCurrency = this.profileService.getProfile()?.currency || '';
    this.loadCategoryShortcuts();
    this.initForm();
    if (!this.isEditMode) this.restoreDraft();
    this.watchDraft();
    if (!this.categoriesLoaded) {
      this.loadCategories();
    }
  }

  private restoreDraft(): void {
    const draft = this.draftService.get(this.ownerId);
    if (!draft) return;
    this.expenseForm.patchValue(draft, { emitEvent: false });
    this.typeSubject$.next(draft.type);
    this.hasDraft = true;
    this.cdr.markForCheck();
  }

  private watchDraft(): void {
    if (this.isEditMode) return;
    this.expenseForm.valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntil(this.destroy$)
      )
      .subscribe((value) => {
        const meaningful =
          !!String(value.amount ?? '').trim() ||
          !!String(value.category ?? '').trim() ||
          !!String(value.description ?? '').trim();
        if (!meaningful) {
          this.draftService.clear(this.ownerId);
          this.hasDraft = false;
          return;
        }
        this.draftService.save(this.ownerId, {
          type: value.type === 'income' ? 'income' : 'outcome',
          amount:
            value.amount === '' || value.amount == null
              ? null
              : Number(value.amount),
          category: value.category || null,
          description: String(value.description || ''),
          date: new Date(value.date).toISOString(),
        });
        this.hasDraft = true;
      });
  }

  override ngOnDestroy() {
    super.ngOnDestroy();
  }

  ngAfterViewInit() {
    setTimeout(() => {
      if (this.formContainerRef?.nativeElement) {
        trapFocus(
          this.formContainerRef.nativeElement.closest(
            'ion-modal, .main-modal, .modal-wrapper'
          ) || this.formContainerRef.nativeElement
        );
      }
    }, 400);
  }

  private initForm(): void {
    const categoryObj =
      this.expense?.category && typeof this.expense.category !== 'string'
        ? this.expense.category
        : null;
    const type = categoryObj?.type || 'outcome';
    const categoryId =
      categoryObj?._id ||
      (typeof this.expense?.category === 'string'
        ? this.expense.category
        : null);

    this.expenseForm = this.fb.group({
      type: [type],
      amount: [
        this.expense?.amount,
        [Validators.required, this.amountValidator()],
      ],
      category: [categoryId, Validators.required],
      description: [
        this.expense?.description,
        [
          Validators.required,
          Validators.pattern(/\S/),
          Validators.maxLength(500),
        ],
      ],
      date: [
        this.expense?.date || new Date().toISOString(),
        Validators.required,
      ],
    });

    this.initialFormValue = this.expenseForm.getRawValue();

    // Initialize typeSubject with the initial type
    this.typeSubject$.next(type);

    // Subscribe to type changes to update filtered categories
    this.typeSubject$.pipe(takeUntil(this.destroy$)).subscribe((t) => {
      this.filteredCategories = this.allCategories.filter(
        (c) => c.type === t || (!c.type && t === 'outcome')
      );
      this.refreshCategoryShortcuts();

      // Reset category if current selection doesn't match new type
      const currentCategoryId = this.expenseForm.get('category')?.value;
      if (currentCategoryId) {
        const currentCategory = this.allCategories.find(
          (c) => c._id === currentCategoryId
        );
        if (currentCategory && currentCategory.type !== t) {
          this.expenseForm.get('category')?.setValue('');
        }
      }
      this.cdr.markForCheck();
    });
  }

  private loadCategories(): void {
    if (this.categoriesLoaded) {
      return;
    }
    this.categoriesLoaded = true;

    this.categoryService
      .getCategories({ skip: 0, limit: 200, sort: 'order' })
      .pipe(
        map((res) => res.data || []),
        takeUntil(this.destroy$)
      )
      .subscribe((categories) => {
        this.allCategories = categories;
        this.categoriesResolved = true;
        if (!this.isEditMode) {
          const category = this.expenseForm.get('category');
          if (
            category?.value &&
            !categories.some((c) => c._id === category.value)
          ) {
            category.setValue('', { emitEvent: false });
          }
        }
        this.validateSelectedCategory();
        this.typeSubject$.next(this.typeSubject$.value); // Trigger filtering again now that we have data
        this.cdr.markForCheck();
      });
  }

  async onDelete(): Promise<void> {
    if (this.isDeleteSubmitting || this.state.loading()) return;
    this.isDeleteSubmitting = true;
    const confirmed = await this.alertService.showDeleteConfirm(
      this.expense?.description || '',
      async () => this.deleteExpense()
    );
    if (!confirmed) {
      this.isDeleteSubmitting = false;
    }
  }

  private deleteExpense(): void {
    this.setLoading(true);
    this.expenseService
      .deleteExpense(this.expense!._id)
      .pipe(
        finalize(() => {
          this.setLoading(false);
          this.isDeleteSubmitting = false;
        })
      )
      .subscribe({
        next: () => {
          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('EXPENSE.DELETE_SUCCESS')
          );
          this.modalCtrl?.dismiss(null, 'delete');
        },
        error: (error) =>
          this.handleError(
            this.translateService.instant('EXPENSE.DELETE_ERROR'),
            error,
            true
          ),
      });
  }

  private isSubmitting = false;

  onSubmit(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    this.expenseForm
      .get('description')
      ?.setValue(
        String(this.expenseForm.get('description')?.value ?? '').trim(),
        { emitEvent: false }
      );
    this.validateSelectedCategory();
    this.expenseForm.updateValueAndValidity();
    // Do not submit an ID before the authoritative owner-scoped category
    // snapshot has arrived; a required-looking stale ID is not sufficient.
    if (!this.categoriesResolved) return;
    if (
      this.expenseForm.invalid ||
      this.isSubmitting ||
      (this.isEditMode && !this.hasFormChanges())
    ) {
      return;
    }
    this.isSubmitting = true;
    this.setLoading(true);
    const formValue = this.expenseForm.value;

    // Remove 'type' from payload - backend determines type from category
    const { type, ...payloadData } = formValue;

    const amount = this.normalizeAmount(payloadData.amount);
    const payload: Partial<Expense> = {
      ...payloadData,
      amount,
      description: String(payloadData.description ?? '').trim(),
      date: this.localCalendarIso(new Date(payloadData.date)),
    };

    const action$ = this.isEditMode
      ? this.expenseService.updateExpense(this.expense!._id, payload)
      : this.expenseService.createExpense(payload);

    action$
      .pipe(
        finalize(() => {
          this.setLoading(false);
          this.isSubmitting = false;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (response) => {
          if (!this.isEditMode) this.draftService.clear(this.ownerId);
          this.recordRecentCategory(String(payloadData.category));
          const message = this.isEditMode
            ? this.translateService.instant('EXPENSE.UPDATE_SUCCESS')
            : this.translateService.instant('EXPENSE.CREATE_SUCCESS');
          this.toastService.presentSuccessToast('bottom', message);
          this.modalCtrl?.dismiss(response, 'confirm');
        },
        error: (error) => {
          const message = this.isEditMode
            ? this.translateService.instant('EXPENSE.UPDATE_ERROR')
            : this.translateService.instant('EXPENSE.CREATE_ERROR');
          this.handleError(message, error, true);
        },
      });
  }

  discardDraft(): void {
    if (this.isEditMode) return;
    this.draftService.clear(this.ownerId);
    this.expenseForm.reset({
      type: 'outcome',
      amount: null,
      category: '',
      description: '',
      date: new Date().toISOString(),
    });
    this.expenseForm.markAsPristine();
    this.hasDraft = false;
    this.toastService.presentSuccessToast(
      'bottom',
      this.translateService.instant('EXPENSE.DRAFT_DISCARDED')
    );
  }

  hasFormChanges(): boolean {
    if (!this.isEditMode || !this.initialFormValue) return true;
    const current = this.expenseForm.getRawValue();
    return ['type', 'amount', 'category', 'description', 'date'].some(
      (key) =>
        String(current[key] ?? '') !==
        String(this.initialFormValue?.[key] ?? '')
    );
  }

  close(): void {
    releaseFocus();
    this.modalCtrl?.dismiss();
  }

  // --- Custom Category Popover Logic ---
  openCategoryPopover(event: Event) {
    this.showCategoryPopover = true;
  }

  closeCategoryPopover() {
    this.showCategoryPopover = false;
  }

  selectCategory(id: string) {
    this.expenseForm.get('category')?.setValue(id);
    this.expenseForm.get('category')?.markAsDirty();
    this.closeCategoryPopover();
  }

  isFavoriteCategory(id: string): boolean {
    return this.favoriteCategoryIds.includes(id);
  }

  toggleFavoriteCategory(id: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.favoriteCategoryIds = this.isFavoriteCategory(id)
      ? this.favoriteCategoryIds.filter((categoryId) => categoryId !== id)
      : [...this.favoriteCategoryIds, id];
    this.persistCategoryShortcuts();
    this.refreshCategoryShortcuts();
  }

  private categoryShortcutKey(): string | null {
    return this.ownerId ? `${this.shortcutStoragePrefix}${this.ownerId}` : null;
  }

  private loadCategoryShortcuts(): void {
    const key = this.categoryShortcutKey();
    if (!key) return;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      this.recentCategoryIds = Array.isArray(stored.recentCategoryIds)
        ? stored.recentCategoryIds
            .filter((id: unknown) => typeof id === 'string')
            .slice(0, this.recentCategoryCap)
        : [];
      this.favoriteCategoryIds = Array.isArray(stored.favoriteCategoryIds)
        ? stored.favoriteCategoryIds.filter(
            (id: unknown) => typeof id === 'string'
          )
        : [];
    } catch {
      this.recentCategoryIds = [];
      this.favoriteCategoryIds = [];
    }
    this.persistCategoryShortcuts();
  }

  private persistCategoryShortcuts(): void {
    const key = this.categoryShortcutKey();
    if (!key) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          recentCategoryIds: this.recentCategoryIds.slice(
            0,
            this.recentCategoryCap
          ),
          favoriteCategoryIds: this.favoriteCategoryIds,
        })
      );
    } catch {
      // Local preferences are optional and must not affect transaction saves.
    }
  }

  private recordRecentCategory(id: string): void {
    if (!id || !this.allCategories.some((category) => category._id === id)) {
      return;
    }
    this.recentCategoryIds = [
      id,
      ...this.recentCategoryIds.filter((categoryId) => categoryId !== id),
    ].slice(0, this.recentCategoryCap);
    this.persistCategoryShortcuts();
    this.refreshCategoryShortcuts();
  }

  private refreshCategoryShortcuts(): void {
    const canonicalIds = new Set(
      this.allCategories.map((category) => category._id).filter(Boolean)
    );
    const validFavorites = this.categoriesResolved
      ? this.favoriteCategoryIds.filter((id) => canonicalIds.has(id))
      : this.favoriteCategoryIds;
    const validRecents = this.categoriesResolved
      ? this.recentCategoryIds.filter((id) => canonicalIds.has(id))
      : this.recentCategoryIds;
    if (
      this.categoriesResolved &&
      (validFavorites.length !== this.favoriteCategoryIds.length ||
        validRecents.length !== this.recentCategoryIds.length)
    ) {
      this.favoriteCategoryIds = validFavorites;
      this.recentCategoryIds = validRecents;
      this.persistCategoryShortcuts();
    }

    const byId = new Map(
      this.filteredCategories.map((category) => [category._id, category])
    );
    const favoriteIds = new Set(validFavorites);
    const recentIds = new Set(validRecents);
    this.favoriteCategories = validFavorites
      .map((id) => byId.get(id))
      .filter((category): category is Category => !!category);
    this.recentCategories = validRecents
      .filter((id) => !favoriteIds.has(id))
      .map((id) => byId.get(id))
      .filter((category): category is Category => !!category);
    this.remainingCategories = this.filteredCategories.filter(
      (category) =>
        !favoriteIds.has(category._id || '') &&
        !recentIds.has(category._id || '')
    );
  }

  /**
   * Up to six one-tap category chips: favorites first, then recents, then
   * the remaining categories of the current type.
   */
  get quickCategories(): Category[] {
    const seen = new Set<string>();
    const result: Category[] = [];
    for (const category of [
      ...this.favoriteCategories,
      ...this.recentCategories,
      ...this.remainingCategories,
    ]) {
      const id = category._id || '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push(category);
      if (result.length === 6) break;
    }
    return result;
  }

  get isIncomeType(): boolean {
    return this.expenseForm?.get('type')?.value === 'income';
  }

  getSelectedCategoryText(): string {
    const id = this.expenseForm.get('category')?.value;
    if (!id) return this.translateService.instant('EXPENSE.CATEGORY');
    const category = this.allCategories.find((c) => c._id === id);
    return category?.title || this.translateService.instant('EXPENSE.CATEGORY');
  }

  getSelectedCategoryIcon(): string {
    const id = this.expenseForm.get('category')?.value;
    const category = this.allCategories.find((c) => c._id === id);
    return category?.icon || 'grid-outline';
  }

  getSelectedCategoryColor(): string {
    const id = this.expenseForm.get('category')?.value;
    const category = this.allCategories.find((c) => c._id === id);
    return category?.color || '';
  }

  onDateChange(event: any): void {
    const value = event.detail?.value;
    if (value) {
      this.expenseForm
        .get('date')
        ?.setValue(this.localCalendarIso(new Date(value)), {
          emitEvent: false,
        });
      this.cdr.markForCheck();
    }
  }

  changeType(type: 'income' | 'outcome'): void {
    // Update form value and clear category
    this.expenseForm.patchValue({ type, category: '' });
    // Emit the new type to trigger filtering
    this.typeSubject$.next(type);
    this.cdr.markForCheck();
  }

  private amountValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const raw = control.value;
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        return { required: true };
      }
      const text = String(raw).trim();
      if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return { amount: true };
      if (text.includes(',') && text.includes('.')) return { amount: true };
      const normalized = text.replace(',', '.');
      const value = Number(normalized);
      return Number.isFinite(value) && value > 0 ? null : { amount: true };
    };
  }

  private normalizeAmount(value: unknown): number {
    const normalized = String(value ?? '')
      .trim()
      .replace(',', '.');
    return Number(normalized);
  }

  private validateSelectedCategory(): void {
    const control = this.expenseForm?.get('category');
    if (!control || !this.categoriesResolved) return;
    const category = this.allCategories.find((c) => c._id === control.value);
    const valid =
      !!category && (category.type || 'outcome') === this.typeSubject$.value;
    control.setErrors(valid ? null : { category: true });
  }

  private localCalendarIso(date: Date): string {
    if (Number.isNaN(date.getTime())) return '';
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      12
    ).toISOString();
  }
}
