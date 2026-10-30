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
    <ion-card class="upgrade-prompt" [color]="color">
      <ion-card-content>
        <div class="prompt-content">
          <div class="icon-section">
            <ion-icon [name]="icon"></ion-icon>
          </div>
          <div class="text-section">
            <h3>{{ title | translate }}</h3>
            <p>{{ message | translate }}</p>
          </div>
          <div class="action-section">
            @if (upgradeAvailable()) {
            <ion-button
              [color]="buttonColor"
              size="small"
              (click)="navigateToSubscription()"
            >
              <ion-icon name="arrow-up-circle" slot="start"></ion-icon>
              {{ 'SUBSCRIPTION.UPGRADE_NOW' | translate }}
            </ion-button>
            } @else {
            <ion-note>{{ 'SUBSCRIPTION.COMING_SOON' | translate }}</ion-note>
            }
          </div>
        </div>
      </ion-card-content>
    </ion-card>
  `,
  styles: [
    `
      .upgrade-prompt {
        margin: 16px;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);

        .prompt-content {
          display: flex;
          align-items: center;
          gap: 16px;

          .icon-section {
            flex-shrink: 0;

            ion-icon {
              font-size: 32px;
            }
          }

          .text-section {
            flex: 1;

            h3 {
              font-size: 16px;
              font-weight: 700;
              margin-bottom: 4px;
            }

            p {
              font-size: 14px;
              opacity: 0.9;
              margin: 0;
            }
          }

          .action-section {
            flex-shrink: 0;

            ion-button {
              --border-radius: 8px;
              font-weight: 600;
            }
          }
        }

        @media (max-width: 576px) {
          .prompt-content {
            flex-direction: column;
            text-align: center;

            .action-section {
              width: 100%;

              ion-button {
                width: 100%;
              }
            }
          }
        }
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
