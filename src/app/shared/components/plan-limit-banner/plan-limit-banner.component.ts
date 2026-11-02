import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';

/**
 * Plan usage notice: one flat panel, a label with "used of limit", a thin
 * track at the true ratio, and the upgrade action only when it matters.
 * Red appears only once the limit is actually reached.
 */
@Component({
  selector: 'app-plan-limit-banner',
  template: `
    <section
      class="plb"
      [class.plb--full]="percentage >= 100"
      [class.plb--near]="percentage >= 90 && percentage < 100"
      role="status"
    >
      <div class="plb__row">
        <div class="plb__text">
          <strong class="plb__title">{{ limitType | translate }}</strong>
          <span class="plb__figure">{{
            limit === null
              ? ('SUBSCRIPTION.UNLIMITED' | translate)
              : ('SUBSCRIPTION.USED_OF'
                | translate : { used: used, limit: limit })
          }}</span>
        </div>
        @if (percentage >= 90) {
        <button
          type="button"
          class="plb__action"
          (click)="navigateToSubscription()"
        >
          {{ 'SUBSCRIPTION.UPGRADE' | translate }}
        </button>
        }
      </div>
      <div
        class="plb__track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="clamped"
        [attr.aria-label]="limitType | translate"
      >
        <i [style.width.%]="clamped"></i>
      </div>
      @if (percentage >= 100) {
      <p class="plb__note">
        {{ 'SUBSCRIPTION.LIMIT_REACHED_MSG' | translate }}
      </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .plb {
        margin: var(--mf-space-3) var(--mf-gutter);
        padding: var(--mf-space-4);
        border-radius: var(--mf-radius-lg);
        background: var(--mf-surface);
        box-shadow: inset 0 0 0 1px var(--mf-separator);
        font-family: var(--mf-font-sans);
      }

      .plb__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--mf-space-3);
        min-height: 28px;
      }

      .plb__text {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px var(--mf-space-2);
        min-width: 0;
      }

      .plb__title {
        font-size: var(--mf-text-callout);
        font-weight: var(--mf-weight-semibold);
        color: var(--mf-ink);
      }

      .plb__figure {
        font-size: var(--mf-text-footnote);
        font-variant-numeric: tabular-nums;
        color: var(--mf-ink-2);
      }

      .plb__action {
        flex: none;
        min-height: var(--mf-touch-target);
        margin-block: -8px;
        padding: 0 var(--mf-space-2);
        border: 0;
        background: transparent;
        font: inherit;
        font-size: var(--mf-text-callout);
        font-weight: var(--mf-weight-semibold);
        color: var(--mf-primary);
        cursor: pointer;
      }

      .plb__action:focus-visible {
        outline: 2px solid var(--mf-focus-ring);
        outline-offset: 2px;
        border-radius: var(--mf-radius-sm);
      }

      .plb__track {
        height: 6px;
        margin-top: var(--mf-space-3);
        overflow: hidden;
        border-radius: var(--mf-radius-pill);
        background: var(--mf-surface-sunken);
      }

      .plb__track i {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--mf-primary);
      }

      .plb--full .plb__track i {
        background: var(--mf-danger);
      }

      .plb__note {
        margin: var(--mf-space-3) 0 0;
        font-size: var(--mf-text-footnote);
        line-height: var(--mf-leading-snug);
        color: var(--mf-ink-2);
      }
    `,
  ],
  standalone: true,
  imports: [CommonModule, TranslateModule],
})
export class PlanLimitBannerComponent {
  @Input() limitType = 'SUBSCRIPTION.CATEGORIES_LIMIT';
  @Input() used = 0;
  @Input() limit: number | null = 0;
  @Input() percentage = 0;

  constructor(private router: Router) {}

  get clamped(): number {
    return Math.max(0, Math.min(100, Math.round(this.percentage)));
  }

  navigateToSubscription() {
    this.router.navigate(['/subscription'], {
      queryParams: { reason: 'limit_reached', limitType: this.limitType },
    });
  }
}
