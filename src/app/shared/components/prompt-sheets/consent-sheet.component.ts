import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

/** Asks once whether to share anonymous usage data. Dismisses with `true` (share) or `false`. */
@Component({
  selector: 'app-consent-sheet',
  standalone: true,
  imports: [IonicModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./prompt-sheets.scss', './consent-sheet.component.scss'],
  template: `
    <div class="mf-sheet__grabber" aria-hidden="true"></div>
    <div class="mf-prompt" role="dialog" aria-labelledby="consent-title">
      <div class="mf-prompt__icon">
        <ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon>
      </div>
      <h2 id="consent-title" class="mf-prompt__title">
        {{ 'TELEMETRY.PROMPT_TITLE' | translate }}
      </h2>
      <p class="mf-prompt__lead">{{ 'TELEMETRY.PROMPT_LEAD' | translate }}</p>

      <ul class="mf-consent__points">
        <li>
          <ion-icon name="pulse-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'TELEMETRY.PROMPT_POINT_COUNT' | translate }}</span>
        </li>
        <li>
          <ion-icon name="eye-off-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'TELEMETRY.PROMPT_POINT_NEVER' | translate }}</span>
        </li>
        <li>
          <ion-icon name="toggle-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'TELEMETRY.PROMPT_POINT_CONTROL' | translate }}</span>
        </li>
      </ul>

      <div class="mf-prompt__actions">
        <button type="button" class="mf-prompt__primary" (click)="answer(true)">
          {{ 'TELEMETRY.PROMPT_ALLOW' | translate }}
        </button>
        <button type="button" class="mf-prompt__secondary" (click)="answer(false)">
          {{ 'TELEMETRY.PROMPT_DECLINE' | translate }}
        </button>
      </div>
    </div>
  `,
})
export class ConsentSheetComponent {
  private readonly modalCtrl = inject(ModalController);

  answer(share: boolean): void {
    void this.modalCtrl.dismiss(share, 'answer');
  }
}
