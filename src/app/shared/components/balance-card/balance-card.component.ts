import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewEncapsulation,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

export interface BalanceCardData {
  balance: number | null;
  income: number | null;
  expenses: number | null;
  percentageChange: number | null;
}

export interface ExpenseComparison {
  status: 'loading' | 'ready' | 'unavailable';
  direction?: 'less' | 'more' | 'same' | 'new' | 'none';
  percentage?: number | null;
}

import { formatMoney } from 'src/app/shared/utils/money-format.util';

@Component({
  selector: 'app-balance-card',
  templateUrl: './balance-card.component.html',
  styleUrls: ['./balance-card.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [IonicModule, DecimalPipe, TranslateModule],
})
export class BalanceCardComponent {
  // Inputs
  @Input() set balance(value: number | null) {
    this._balanceSignal.set(value);
  }
  @Input() set income(value: number | null) {
    this._incomeSignal.set(value);
  }
  @Input() set expenses(value: number | null) {
    this._expensesSignal.set(value);
  }
  @Input() percentageChange: number | null = null;
  @Input() expenseComparison: ExpenseComparison | null = null;
  @Input() isLoading = false;
  @Input() currency: string = 'EGP';
  @Input() animationEnabled = true;
  @Input() showPercentageBadge = true;

  // Outputs
  @Output() balanceToggled = new EventEmitter<boolean>();
  @Output() cardClicked = new EventEmitter<BalanceCardData>();

  // Signals
  private _balanceSignal = signal<number | null>(null);
  private _incomeSignal = signal<number | null>(null);
  private _expensesSignal = signal<number | null>(null);
  private _showBalanceSignal = signal<boolean>(true);

  // Computed values
  showBalance = computed(() => this._showBalanceSignal());

  formattedBalance = computed(() =>
    this.formatAmount(this._balanceSignal(), this._showBalanceSignal(), false)
  );

  formattedIncome = computed(() =>
    this.formatAmount(this._incomeSignal(), this._showBalanceSignal())
  );

  formattedExpenses = computed(() =>
    this.formatAmount(this._expensesSignal(), this._showBalanceSignal())
  );

  savings = computed(() => {
    const income = this._incomeSignal() ?? 0;
    const expenses = this._expensesSignal() ?? 0;
    return income - expenses;
  });

  savingsPercentage = computed(() => {
    const income = this._incomeSignal() ?? 0;
    if (income === 0) return 0;
    return (this.savings() / income) * 100;
  });

  isPositiveSavings = computed(() => this.savings() >= 0);

  // Animation state
  get cardAnimationClass(): string {
    return this.animationEnabled ? 'fade-in-up' : '';
  }

  /**
   * Format amount with currency
   */
  formatAmount(
    amount: number | null,
    show: boolean,
    includeCurrency = true
  ): string {
    if (!show) return '•••••';
    if (amount === null || amount === undefined) return '-';

    // Shared ledger formatting: Western digits, true minus, two decimals.
    return formatMoney(amount, {
      currency: includeCurrency ? this.currency : null,
      showSign: false,
    });
  }

  /**
   * Toggle balance visibility
   */
  toggleBalance(): void {
    const newValue = !this._showBalanceSignal();
    this._showBalanceSignal.set(newValue);
    this.balanceToggled.emit(newValue);
  }

  /**
   * Handle card click
   */
  onCardClick(): void {
    if (!this.isLoading) {
      this.cardClicked.emit({
        balance: this._balanceSignal(),
        income: this._incomeSignal(),
        expenses: this._expensesSignal(),
        percentageChange: this.percentageChange,
      });
    }
  }

  /**
   * Get percentage change icon
   */
  getPercentageIcon(): string {
    if (this.percentageChange === null) return '';
    return this.percentageChange >= 0 ? 'trending-up' : 'trending-down';
  }

  /**
   * Get savings icon
   */
  getSavingsIcon(): string {
    return this.isPositiveSavings() ? 'wallet' : 'alert-circle';
  }
}
