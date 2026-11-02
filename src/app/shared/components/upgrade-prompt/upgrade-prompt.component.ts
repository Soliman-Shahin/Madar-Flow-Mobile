import { Component, Input, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PlanService } from 'src/app/core/services/plan.service';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { PlanSlug } from '../../models/plan.model';

@Component({
  selector: 'app-upgrade-prompt',
  template: `
    <section
      class="upgrade-prompt"
      role="region"
      [attr.aria-label]="title | translate"
    >
      <span class="icon-section" aria-hidden="true">
        <ion-icon [name]="icon"></ion-icon>
      </span>
      <div class="text-section">
        <h3>{{ title | translate }}</h3>
        <p>{{ message | translate }}</p>
      </div>
      @if (upgradeAvailable()) {
      <ion-button
        class="upgrade-action"
        expand="block"
        (click)="navigateToSubscription()"
      >
        {{ 'SUBSCRIPTION.UPGRADE_NOW' | translate }}
      </ion-button>
      } @else {
      <ion-note>{{ 'SUBSCRIPTION.COMING_SOON' | translate }}</ion-note>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .upgrade-prompt {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--mf-space-3) var(--mf-space-4);
        align-items: center;
        margin: var(--mf-space-4) 0;
        padding: var(--mf-space-4);
        border-radius: var(--mf-radius-lg);
        background: var(--mf-surface);
        font-family: var(--mf-font-sans);
        color: var(--mf-ink);
      }

      .icon-section {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border-radius: 14px;
        background: var(--mf-primary-soft);
        color: var(--mf-primary);
      }

      .icon-section ion-icon {
        font-size: 24px;
      }

      h3 {
        margin: 0 0 2px;
        font-size: var(--mf-text-headline);
        font-weight: var(--mf-weight-semibold);
        color: var(--mf-ink);
      }

      p {
        margin: 0;
        font-size: var(--mf-text-footnote);
        line-height: var(--mf-leading-snug);
        color: var(--mf-ink-2);
      }

      .upgrade-action,
      ion-note {
        grid-column: 1 / -1;
      }

      .upgrade-action {
        --background: var(--mf-primary);
        --color: var(--mf-primary-contrast);
        --border-radius: 14px;
        min-height: 48px;
        margin: 0;
        font-weight: var(--mf-weight-semibold);
        text-transform: none;
        letter-spacing: 0;
      }
    `,
  ],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
})
export class UpgradePromptComponent {
  @Input() title = 'SUBSCRIPTION.FEATURE_LOCKED';
  @Input() message = 'SUBSCRIPTION.FEATURE_LOCKED_MSG';
  @Input() icon = 'lock-closed';
  /** Kept for existing callers; the ledger look uses one neutral style. */
  @Input() color: 'primary' | 'warning' | 'danger' = 'warning';
  @Input() buttonColor = 'primary';
  @Input() requiredPlan?: PlanSlug;

  private readonly planService = inject(PlanService);

  /** Paid plans cannot be bought yet when the server says so. */
  readonly upgradeAvailable = toSignal(
    this.planService.currentPlan$.pipe(map((p) => p?.upgradeAvailable !== false)),
    { initialValue: true }
  );

  constructor(private router: Router) {}

  navigateToSubscription() {
    const queryParams = this.requiredPlan
      ? { reason: 'feature_locked', requiredPlan: this.requiredPlan }
      : { reason: 'feature_locked' };

    this.router.navigate(['/subscription'], { queryParams });
  }
}
