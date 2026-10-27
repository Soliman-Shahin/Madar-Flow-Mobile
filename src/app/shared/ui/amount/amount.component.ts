import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  formatMoneyParts,
  MoneyKind,
} from 'src/app/shared/utils/money-format.util';

export type AmountSize = 'hero' | 'lg' | 'md' | 'sm';

/**
 * Unified money display (Calm Personal Ledger).
 *
 * Renders an isolated left-to-right run (`<bdi dir="ltr">`) so the sign and
 * currency never flip in Arabic, with tabular Western digits and a true minus.
 * Expenses use the surrounding ink color; only income is tinted.
 *
 * Usage:
 *   <app-amount [value]="t.amount" kind="expense" [currency]="userCurrency" />
 *   <app-amount [value]="balance" size="hero" [currency]="currency" />
 */
@Component({
  selector: 'app-amount',
  standalone: true,
  templateUrl: './amount.component.html',
  styleUrls: ['./amount.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
  },
})
export class AmountComponent {
  /** Magnitude for income/expense; signed value for neutral. */
  readonly value = input<number | null | undefined>(null);
  readonly kind = input<MoneyKind>('neutral');
  readonly currency = input<string | null | undefined>(null);
  readonly size = input<AmountSize>('md');
  readonly showSign = input(true);
  /** Hide the digits (privacy mode). */
  readonly masked = input(false);
  /** Accessible name used while masked; pass a translated string. */
  readonly maskedLabel = input('Hidden amount');

  readonly parts = computed(() =>
    formatMoneyParts(this.value(), this.kind(), this.showSign())
  );

  readonly hostClass = computed(
    () => `mf-amount mf-amount--${this.size()} mf-amount--${this.kind()}`
  );
}
