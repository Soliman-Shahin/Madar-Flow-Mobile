import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { SUPPORTED_CURRENCIES } from 'src/app/shared/utils';

/**
 * Picks the account currency. There is no "later": the device-region suggestion is
 * pre-selected, so confirming is one tap, and every account ends up with a currency.
 */
@Component({
  selector: 'app-currency-sheet',
  standalone: true,
  imports: [IonicModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./prompt-sheets.scss', './currency-sheet.component.scss'],
  template: `
    <div class="mf-sheet__grabber" aria-hidden="true"></div>
    <div class="mf-prompt" role="dialog" aria-labelledby="currency-title">
      <div class="mf-prompt__icon">
        <ion-icon name="cash-outline" aria-hidden="true"></ion-icon>
      </div>
      <h2 id="currency-title" class="mf-prompt__title">
        {{ 'MOBILE.CURRENCY_PROMPT_TITLE' | translate }}
      </h2>
      <p class="mf-prompt__lead">
        {{ 'MOBILE.CURRENCY_PROMPT_MESSAGE' | translate }}
      </p>

      <div
        class="mf-currency__grid"
        role="radiogroup"
        aria-labelledby="currency-title"
      >
        @for (code of currencies; track code) {
        <button
          type="button"
          role="radio"
          class="mf-currency__chip"
          [class.is-selected]="selected() === code"
          [attr.aria-checked]="selected() === code"
          (click)="selected.set(code)"
        >
          <span class="mf-currency__code">{{ code }}</span>
          <span class="mf-currency__name">{{ nameOf(code) }}</span>
        </button>
        }
      </div>

      <div class="mf-prompt__actions">
        <button type="button" class="mf-prompt__primary" (click)="save()">
          {{ 'COMMON.SAVE' | translate }}
        </button>
      </div>
    </div>
  `,
})
export class CurrencySheetComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  @Input() suggested: string = SUPPORTED_CURRENCIES[0];
  @Input() locale = 'en';

  readonly currencies = SUPPORTED_CURRENCIES;
  readonly selected = signal<string>(SUPPORTED_CURRENCIES[0]);
  private names?: Intl.DisplayNames;

  ngOnInit(): void {
    this.selected.set(this.suggested);
    try {
      this.names = new Intl.DisplayNames([this.locale], { type: 'currency' });
    } catch {
      this.names = undefined;
    }
  }

  nameOf(code: string): string {
    try {
      return this.names?.of(code) ?? code;
    } catch {
      return code;
    }
  }

  save(): void {
    void this.modalCtrl.dismiss(this.selected(), 'save');
  }

}
