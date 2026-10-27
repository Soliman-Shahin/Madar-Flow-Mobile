import {
  Component,
  Input,
  inject,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Expense } from 'src/app/shared/models/expense.model';
import { AmountComponent } from 'src/app/shared/ui/amount/amount.component';
import { OfflineStorageService } from 'src/app/core/services/offline-storage.service';
import { ExpenseService } from 'src/app/core/services/expense.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';
import { merge, skip, startWith, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-expense-detail',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule, AmountComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './expense-detail.component.html',
  styleUrls: ['./expense-detail.component.scss'],
})
export class ExpenseDetailComponent implements OnInit {
  private readonly offlineStorage = inject(OfflineStorageService);
  private readonly expenseService = inject(ExpenseService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ownerId = this.authService.getUserId();
  readonly detailExpense = signal<Expense>(null as unknown as Expense);
  readonly isUnavailable = signal(false);
  private logicalId = '';
  private syncOperations: any[] = [];
  private hasSeenCanonicalEntity = false;
  syncState: 'synced' | 'pending' | 'issue' = 'synced';
  get categoryVisual(): any {
    return typeof this.detailExpense().category === 'object'
      ? this.detailExpense().category
      : null;
  }
  @Input({ required: true }) expense!: Expense;
  @Input() currency = '';
  @Input() categoryName = '';
  @Input() locale = 'en';
  private readonly modal = inject(ModalController);

  ngOnInit(): void {
    this.detailExpense.set(this.expense);
    this.logicalId =
      (this.expense as Expense & { _clientId?: string })._clientId ||
      this.expense._id;

    this.authService.userChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (!user || String(user._id) !== String(this.ownerId)) {
          this.markUnavailable();
        }
      });

    merge(
      this.offlineStorage.syncQueue$.pipe(skip(1)),
      this.expenseService.expenseReconciled$
    )
      .pipe(
        startWith(null),
        tap((event: any) => {
          if (event?.operations) this.syncOperations = event.operations;
        }),
        switchMap(() => this.offlineStorage.getEntities<any>('expense')),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((entities) =>
        this.updateFromAuthoritativeLocalState(entities)
      );
  }

  get syncLabelKey(): string {
    return `SYNC.DETAIL_${this.syncState.toUpperCase()}`;
  }

  get syncDescriptionKey(): string {
    return `SYNC.DETAIL_${this.syncState.toUpperCase()}_DESCRIPTION`;
  }

  get syncIcon(): string {
    if (this.syncState === 'pending') return 'time-outline';
    if (this.syncState === 'issue') return 'alert-circle-outline';
    return 'checkmark-circle-outline';
  }

  private updateFromAuthoritativeLocalState(entities: any[]): void {
    if (!Array.isArray(entities)) return;
    const currentId = this.detailExpense()?._id;
    const entity = entities.find(
      (candidate) =>
        candidate._id === currentId ||
        candidate._id === this.logicalId ||
        candidate._clientId === this.logicalId
    );

    if (!entity) {
      if (this.hasSeenCanonicalEntity) this.markUnavailable();
      return;
    }
    if (entity._isDeleted) {
      void this.modal.dismiss(null, 'deleted');
      return;
    }

    this.hasSeenCanonicalEntity = true;
    this.isUnavailable.set(false);
    this.detailExpense.set(entity as Expense);
    const operations = this.syncOperations.filter(
      (operation) =>
        operation.entityType === 'expense' &&
        [this.logicalId, entity._id, entity._clientId].includes(
          operation.entityId
        )
    );
    const status = entity._syncStatus;
    this.syncState =
      operations.some((operation) => operation.status === SyncStatus.ERROR) ||
      [SyncStatus.ERROR, SyncStatus.CONFLICT].includes(status)
        ? 'issue'
        : status === SyncStatus.PENDING ||
          (status !== SyncStatus.SYNCED &&
            operations.some(
              (operation) => operation.status === SyncStatus.PENDING
            ))
        ? 'pending'
        : 'synced';
  }

  private markUnavailable(): void {
    this.isUnavailable.set(true);
  }
  close() {
    return this.modal.dismiss();
  }
  edit() {
    return this.modal.dismiss(null, 'edit');
  }

  get isIncome(): boolean {
    const categoryType = (this.categoryVisual as any)?.type;
    return (
      categoryType === 'income' ||
      (this.detailExpense() as any)?.type === 'income'
    );
  }

  get absoluteAmount(): number | null {
    const amount = Number(this.detailExpense()?.amount);
    return Number.isFinite(amount) ? Math.abs(amount) : null;
  }

  /** Full date in the record language, with Western digits. */
  get formattedDate(): string {
    return new Intl.DateTimeFormat(this.locale || 'en', {
      dateStyle: 'full',
      numberingSystem: 'latn',
    }).format(new Date(this.detailExpense()?.date));
  }

  get isValidDate(): boolean {
    const timestamp = new Date(this.detailExpense()?.date).getTime();
    return Number.isFinite(timestamp);
  }
}
