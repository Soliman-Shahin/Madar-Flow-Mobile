import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AmountComponent } from '../amount/amount.component';

/** Day heading for a ledger group: label on the start side, net on the end. */
@Component({
  selector: 'app-ledger-day-header',
  standalone: true,
  imports: [AmountComponent],
  template: `
    <h2 class="mf-day__label">{{ label() }}</h2>
    @if (net() !== null && net() !== undefined) {
    <app-amount
      class="mf-day__net"
      size="sm"
      kind="neutral"
      [value]="net()"
      [currency]="currency()"
      [attr.aria-label]="totalLabel() || null"
    />
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--mf-space-3);
        padding-block: var(--mf-space-5) var(--mf-space-2);
        padding-inline: var(--mf-space-1);
        font-family: var(--mf-font-sans);
      }
      .mf-day__label {
        margin: 0;
        font-size: var(--mf-text-footnote);
        font-weight: var(--mf-weight-semibold);
        line-height: var(--mf-leading-snug);
        color: var(--mf-ink-2);
      }
      .mf-day__net {
        color: var(--mf-ink-3);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LedgerDayHeaderComponent {
  readonly label = input.required<string>();
  /** Signed net for the day. */
  readonly net = input<number | null | undefined>(null);
  readonly currency = input<string | null | undefined>(null);
  /** Optional accessible prefix, e.g. "Day total". */
  readonly totalLabel = input<string | null>(null);
}
