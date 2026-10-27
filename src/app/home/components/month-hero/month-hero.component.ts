import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { AmountComponent } from 'src/app/shared/ui/amount/amount.component';
import { ExpenseComparison } from 'src/app/shared/components/balance-card/balance-card.component';

/**
 * Home hero — Calm Personal Ledger.
 * The month's spending is the single hero number; a pace bar shows spending
 * against income; income and what is left are quiet supporting facts.
 */
@Component({
  selector: 'app-month-hero',
  standalone: true,
  imports: [IonicModule, TranslateModule, AmountComponent],
  templateUrl: './month-hero.component.html',
  styleUrls: ['./month-hero.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonthHeroComponent {
  readonly income = input<number | null | undefined>(0);
  readonly expenses = input<number | null | undefined>(0);
  readonly balance = input<number | null | undefined>(0);
  readonly currency = input<string | null | undefined>(null);
  /** Localized month name, e.g. "October 2026"; used for past months. */
  readonly monthLabel = input<string>('');
  readonly isCurrentMonth = input(true);
  readonly comparison = input<ExpenseComparison | null>(null);
  readonly masked = input(false);

  readonly maskedChange = output<boolean>();

  readonly hasIncome = computed(() => (this.income() ?? 0) > 0);

  /** Share of income spent, 0–100+ (null when there is no income). */
  readonly spentShare = computed(() => {
    const income = this.income() ?? 0;
    if (income <= 0) return null;
    return ((this.expenses() ?? 0) / income) * 100;
  });

  readonly paceWidth = computed(() => {
    const share = this.spentShare();
    return share === null ? 0 : Math.min(100, Math.max(0, share));
  });

  readonly isOver = computed(() => (this.balance() ?? 0) < 0);

  readonly roundedShare = computed(() => Math.round(this.spentShare() ?? 0));

  readonly comparisonPercent = computed(() =>
    Math.round(Math.abs(this.comparison()?.percentage ?? 0))
  );

  toggleMasked(): void {
    this.maskedChange.emit(!this.masked());
  }
}
