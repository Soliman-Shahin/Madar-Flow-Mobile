import { ChangeDetectionStrategy, Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { VAULT_CURRENCIES, currencyName } from 'src/app/core/vault/vault-meta';

interface Option {
  code: string;
  name: string;
}

/** Pick a currency from a searchable list (by code or by name in the app language). */
@Component({
  selector: 'app-currency-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonicModule, FormsModule, TranslateModule],
  styleUrls: ['./currency-picker.component.scss'],
  template: `
    <ion-content class="cp">
      <div class="cp__body">
        <div class="cp__head">
          <button type="button" class="cp__cancel" (click)="close()">
            {{ 'COMMON.CANCEL' | translate }}
          </button>
          <h2 class="cp__title">{{ 'VAULT.CURRENCY' | translate }}</h2>
          <span></span>
        </div>
        <input
          class="cp__search"
          type="search"
          autocomplete="off"
          [placeholder]="'VAULT.CURRENCY_SEARCH' | translate"
          [attr.aria-label]="'VAULT.CURRENCY_SEARCH' | translate"
          [ngModel]="query"
          (ngModelChange)="query = $event; filter()"
        />
        @if (shown.length) {
        <ul class="cp__list" role="listbox">
          @for (o of shown; track o.code) {
          <li>
            <button
              type="button"
              role="option"
              class="cp__item"
              [class.cp__item--on]="o.code === selected"
              [attr.aria-selected]="o.code === selected"
              (click)="pick(o.code)"
            >
              <span class="cp__code">{{ o.code }}</span>
              <span class="cp__name">{{ o.name }}</span>
              @if (o.code === selected) {
              <ion-icon name="checkmark" aria-hidden="true"></ion-icon>
              }
            </button>
          </li>
          }
        </ul>
        } @else {
        <p class="cp__empty">{{ 'VAULT.NO_MATCH' | translate }}</p>
        }
      </div>
    </ion-content>
  `,
})
export class CurrencyPickerComponent implements OnInit {
  @Input() selected = '';
  @Input() exclude = '';
  @Input() locale = 'en';

  private readonly modals = inject(ModalController);
  query = '';
  private all: Option[] = [];
  shown: Option[] = [];

  ngOnInit(): void {
    this.all = VAULT_CURRENCIES.filter((c) => c !== this.exclude).map((code) => ({
      code,
      name: currencyName(code, this.locale),
    }));
    this.filter();
  }

  filter(): void {
    const q = this.query.trim().toLowerCase();
    this.shown = q
      ? this.all.filter((o) => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
      : this.all;
  }

  pick(code: string): void {
    void this.modals.dismiss(code, 'select');
  }

  close(): void {
    void this.modals.dismiss(null, 'cancel');
  }
}
