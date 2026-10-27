import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { AmountComponent } from '../amount/amount.component';
import { MoneyKind } from 'src/app/shared/utils/money-format.util';

/**
 * One transaction row in a Calm Personal Ledger group.
 * Presentational only: the host list owns tap, swipe, and navigation.
 */
@Component({
  selector: 'app-ledger-row',
  standalone: true,
  imports: [IonicModule, AmountComponent],
  templateUrl: './ledger-row.component.html',
  styleUrls: ['./ledger-row.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LedgerRowComponent {
  readonly title = input.required<string>();
  /** Category name shown under the title. */
  readonly category = input<string | null | undefined>(null);
  /** Category color (any CSS color); tinted down for the mark. */
  readonly color = input<string | null | undefined>(null);
  readonly icon = input<string | null | undefined>('pricetag-outline');
  readonly amount = input<number | null | undefined>(null);
  readonly kind = input<MoneyKind>('expense');
  readonly currency = input<string | null | undefined>(null);
  /** Translated sync status; pass null when the row is in sync. */
  readonly status = input<string | null | undefined>(null);
  readonly statusTone = input<'pending' | 'problem'>('pending');
}
