import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { formatCurrency } from 'src/app/shared/utils';
import { ledgerFormSheet } from 'src/app/shared/ui/sheet/sheet-options';
import { CurrencyPickerComponent } from '../currency-picker/currency-picker.component';
import { VaultService } from 'src/app/core/vault/vault.service';
import {
  ASSET_META,
  ASSET_TYPES,
  KARATS,
  currencyName,
  toDateInput,
} from 'src/app/core/vault/vault-meta';
import {
  GoldPriceOverride,
  convert,
  goldPerGram24,
  priceForKarat,
  valuate,
} from 'src/app/core/vault/vault-valuation';
import { AssetType, GoldForm, GoldKarat, MarketPrices, VaultAsset } from 'src/app/core/vault/vault.types';

type Draft = Omit<VaultAsset, 'id' | 'ownerUserId' | 'updatedAt' | 'synced'> & { id?: string };

/**
 * Add or edit one saved item. Fields change with the kind (weight and karat
 * for gold, amount and rate for cash, and so on); under them a live line shows
 * what it is worth today, so the person sees the effect of every number.
 */
@Component({
  selector: 'app-asset-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonicModule, FormsModule, TranslateModule],
  styleUrls: ['./asset-form.component.scss'],
  template: `
    <ion-content class="vf">
      <div class="vf__body">
        <div class="vf__head">
          <button type="button" class="vf__cancel" (click)="cancel()">
            {{ 'COMMON.CANCEL' | translate }}
          </button>
          <h2 class="vf__title">
            {{ (existing ? 'VAULT.EDIT_TITLE' : 'VAULT.ADD_TITLE') | translate }}
          </h2>
          <span></span>
        </div>

        @if (!existing) {
        <div class="vf__types" role="radiogroup" [attr.aria-label]="'VAULT.KIND' | translate">
          @for (t of types; track t) {
          <button
            type="button"
            role="radio"
            class="vf__type"
            [class.vf__type--on]="type === t"
            [attr.aria-checked]="type === t"
            (click)="setType(t)"
          >
            <ion-icon [name]="meta[t].icon" aria-hidden="true"></ion-icon>
            <span>{{ 'VAULT.TYPE_' + t | translate }}</span>
          </button>
          }
        </div>
        }

        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.NAME' | translate }}</span>
          <input
            class="vf__input"
            type="text"
            maxlength="80"
            [(ngModel)]="name"
            [placeholder]="'VAULT.NAME_PH_' + type | translate"
            autocomplete="off"
          />
        </label>

        @switch (type) { @case ('gold') {
        <div class="vf__row">
          <label class="vf__field">
            <span class="vf__label">{{ 'VAULT.GRAMS' | translate }}</span>
            <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="grams" />
          </label>
          <label class="vf__field">
            <span class="vf__label">{{ 'VAULT.FORM' | translate }}</span>
            <select class="vf__input" [(ngModel)]="goldForm">
              @for (f of goldForms; track f) {
              <option [value]="f">{{ 'VAULT.FORM_' + f | translate }}</option>
              }
            </select>
          </label>
        </div>
        <div class="vf__field">
          <span class="vf__label" id="vf-karat">{{ 'VAULT.KARAT' | translate }}</span>
          <div class="vf__chips" role="radiogroup" aria-labelledby="vf-karat">
            @for (k of karats; track k) {
            <button
              type="button"
              role="radio"
              class="vf__chip"
              [class.vf__chip--on]="karat === k"
              [attr.aria-checked]="karat === k"
              (click)="karat = k"
            >
              {{ k }}
            </button>
            }
          </div>
        </div>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.PRICE_PER_GRAM' | translate : { currency: base } }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="pricePerGram" />
          @if (todayGoldPrice !== null) {
          <button type="button" class="vf__link" (click)="useTodayGold()">
            {{ 'VAULT.USE_TODAY_GOLD' | translate : { price: fmt(todayGoldPrice) } }}
          </button>
          }
        </label>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.MAKING' | translate : { currency: base } }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="making" />
          <span class="vf__hint">{{ 'VAULT.MAKING_HINT' | translate }}</span>
        </label>
        } @case ('currency') {
        <div class="vf__field">
          <span class="vf__label">{{ 'VAULT.CURRENCY' | translate }}</span>
          <button type="button" class="vf__input vf__select" (click)="pickCurrency()">
            {{ code }} · {{ nameOf(code) }}
          </button>
        </div>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.AMOUNT' | translate }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="amount" />
        </label>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.RATE_PAID' | translate : { code: code, currency: base } }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="rate" />
          @if (todayRate !== null) {
          <button type="button" class="vf__link" (click)="useTodayRate()">
            {{ 'VAULT.USE_TODAY_RATE' | translate : { rate: fmt(todayRate) } }}
          </button>
          }
        </label>
        } @case ('certificate') {
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.BANK' | translate }}</span>
          <input class="vf__input" type="text" maxlength="60" [(ngModel)]="bank" autocomplete="off" />
        </label>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.PRINCIPAL' | translate : { currency: base } }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="principal" />
        </label>
        <div class="vf__row">
          <label class="vf__field">
            <span class="vf__label">{{ 'VAULT.ANNUAL_RATE' | translate }}</span>
            <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" max="100" [(ngModel)]="annualRate" />
          </label>
          <label class="vf__field">
            <span class="vf__label">{{ 'VAULT.TERM_MONTHS' | translate }}</span>
            <input class="vf__input" type="number" inputmode="numeric" step="1" min="1" [(ngModel)]="termMonths" />
          </label>
        </div>
        } @case ('investment') {
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.SYMBOL' | translate }}</span>
          <input class="vf__input" type="text" maxlength="20" [(ngModel)]="symbol" autocomplete="off" />
        </label>
        <div class="vf__row">
          <label class="vf__field">
            <span class="vf__label">{{ 'VAULT.QUANTITY' | translate }}</span>
            <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="quantity" />
          </label>
          <label class="vf__field">
            <span class="vf__label">{{ 'VAULT.BUY_PRICE' | translate : { currency: base } }}</span>
            <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="buyPrice" />
          </label>
        </div>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.CURRENT_PRICE' | translate : { currency: base } }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="currentPrice" />
          <span class="vf__hint">{{ 'VAULT.CURRENT_PRICE_HINT' | translate }}</span>
        </label>
        } @default {
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.PAID' | translate : { currency: base } }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="paid" />
        </label>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.CURRENT_VALUE' | translate : { currency: base } }}</span>
          <input class="vf__input" type="number" inputmode="decimal" step="any" min="0" [(ngModel)]="currentValue" />
          <span class="vf__hint">{{ 'VAULT.CURRENT_VALUE_HINT' | translate }}</span>
        </label>
        } }

        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.DATE' | translate }}</span>
          <input class="vf__input" type="date" [(ngModel)]="date" [max]="today" />
        </label>
        <label class="vf__field">
          <span class="vf__label">{{ 'VAULT.NOTE' | translate }}</span>
          <input class="vf__input" type="text" maxlength="200" [(ngModel)]="note" autocomplete="off" />
        </label>

        @if (preview; as p) {
        <section class="vf__preview" aria-live="polite">
          <div class="vf__preview-line">
            <span class="vf__preview-label">{{ 'VAULT.PAID_TOTAL' | translate }}</span>
            <span class="vf__preview-value">{{ money(p.cost) }}</span>
          </div>
          @if (p.value !== null) {
          <div class="vf__preview-line">
            <span class="vf__preview-label">{{ 'VAULT.WORTH_TODAY' | translate }}</span>
            <strong class="vf__preview-value">{{ money(p.value) }}</strong>
          </div>
          @if (p.gain !== null) {
          <div class="vf__preview-line">
            <span class="vf__preview-label">{{ 'VAULT.GAIN' | translate }}</span>
            <span class="vf__preview-value" [class.vf__pos]="p.gain > 0" [class.vf__neg]="p.gain < 0" dir="ltr">
              {{ signed(p.gain) }}{{ p.gainPct !== null ? ' (' + pct(p.gainPct) + ')' : '' }}
            </span>
          </div>
          } } @else {
          <p class="vf__preview-note">{{ 'VAULT.NO_PRICE' | translate }}</p>
          }
        </section>
        }

        @if (existing) {
        <div class="vf__more">
          <button type="button" class="vf__secondary" (click)="toggleSold()">
            {{ (status === 'sold' ? 'VAULT.MARK_HELD' : 'VAULT.MARK_SOLD') | translate }}
          </button>
          <button type="button" class="vf__danger" (click)="confirmDelete()">
            {{ 'VAULT.DELETE' | translate }}
          </button>
        </div>
        }
      </div>
    </ion-content>
    <ion-footer class="vf__footer">
      <div class="vf__actions">
        <ion-button class="vf__submit" [disabled]="!valid || saving" (click)="save()">
          {{ 'VAULT.SAVE' | translate }}
        </ion-button>
      </div>
    </ion-footer>
  `,
})
export class AssetFormComponent implements OnInit {
  @Input() existing?: VaultAsset;
  @Input() base = '';
  @Input() prices: MarketPrices | null = null;
  @Input() goldOverride: GoldPriceOverride | null = null;
  @Input() initialType: AssetType = 'gold';

  private readonly vault = inject(VaultService);
  private readonly modals = inject(ModalController);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly types = ASSET_TYPES;
  readonly meta = ASSET_META;
  readonly karats = KARATS;
  readonly goldForms: GoldForm[] = ['jewelry', 'bar', 'coin'];
  readonly today = toDateInput(new Date());

  type: AssetType = 'gold';
  status: 'held' | 'sold' = 'held';
  saleAmount?: number;
  soldAt?: string;
  saving = false;

  name = '';
  date = this.today;
  note = '';
  // gold
  grams: number | null = null;
  karat: GoldKarat = 21;
  goldForm: GoldForm = 'jewelry';
  pricePerGram: number | null = null;
  making: number | null = null;
  // currency
  code = 'USD';
  amount: number | null = null;
  rate: number | null = null;
  // certificate
  bank = '';
  principal: number | null = null;
  annualRate: number | null = null;
  termMonths: number | null = null;
  // investment
  symbol = '';
  quantity: number | null = null;
  buyPrice: number | null = null;
  currentPrice: number | null = null;
  // other
  paid: number | null = null;
  currentValue: number | null = null;

  private get locale(): string {
    return this.translate.currentLang || 'en';
  }

  ngOnInit(): void {
    this.type = this.existing?.type ?? this.initialType;
    if (this.code === this.base) this.code = this.base === 'USD' ? 'EUR' : 'USD';
    const a = this.existing;
    if (!a) return;
    this.name = a.name;
    this.note = a.note ?? '';
    this.date = toDateInput(a.purchasedAt);
    this.status = a.status;
    this.saleAmount = a.saleAmount;
    this.soldAt = a.soldAt;
    switch (a.type) {
      case 'gold': {
        const d = a.details as any;
        this.grams = d.grams;
        this.karat = d.karat;
        this.goldForm = d.form;
        this.pricePerGram = d.pricePerGram ?? null;
        this.making = d.makingCharge ?? null;
        break;
      }
      case 'currency': {
        const d = a.details as any;
        this.code = d.code;
        this.amount = d.amount;
        this.rate = d.rate;
        break;
      }
      case 'certificate': {
        const d = a.details as any;
        this.bank = d.bank ?? '';
        this.principal = d.principal;
        this.annualRate = d.annualRate;
        this.termMonths = d.termMonths;
        break;
      }
      case 'investment': {
        const d = a.details as any;
        this.symbol = d.symbol;
        this.quantity = d.quantity;
        this.buyPrice = d.buyPrice;
        this.currentPrice = d.currentPrice ?? null;
        break;
      }
      default: {
        this.paid = a.cost.amount;
        this.currentValue = (a.details as any).currentValue;
      }
    }
  }

  async pickCurrency(): Promise<void> {
    const m = await this.modals.create({
      component: CurrencyPickerComponent,
      componentProps: { selected: this.code, exclude: this.base, locale: this.locale },
      ...ledgerFormSheet(),
    });
    await m.present();
    const { data, role } = await m.onDidDismiss<string>();
    if (role === 'select' && data) {
      this.code = data;
      this.cdr.markForCheck();
    }
  }

  setType(t: AssetType): void {
    this.type = t;
  }

  // ---- today's price helpers ------------------------------------------

  /** Today's price of one gram of the chosen karat, in the base currency. */
  get todayGoldPrice(): number | null {
    const p24 = goldPerGram24(this.base, this.prices, this.goldOverride);
    return p24 === null ? null : round2(priceForKarat(p24, this.karat));
  }

  get todayRate(): number | null {
    if (!this.prices) return null;
    const r = convert(1, this.code, this.base, this.prices.usdPer);
    return r === null ? null : round4(r);
  }

  useTodayGold(): void {
    if (this.todayGoldPrice !== null) this.pricePerGram = this.todayGoldPrice;
  }

  useTodayRate(): void {
    if (this.todayRate !== null) this.rate = this.todayRate;
  }

  // ---- building the item ----------------------------------------------

  private num(v: number | null): number | null {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  }

  /** The item as it would be saved, or null while something required is missing. */
  get draft(): Draft | null {
    const name = this.name.trim();
    if (!name || !this.date) return null;
    const common = {
      id: this.existing?.id,
      name,
      status: this.status,
      purchasedAt: new Date(this.date + 'T12:00:00').toISOString(),
      note: this.note.trim() || undefined,
      soldAt: this.status === 'sold' ? this.soldAt : undefined,
      saleAmount: this.status === 'sold' ? this.saleAmount : undefined,
      deleted: false,
    };
    const base = this.base;
    switch (this.type) {
      case 'gold': {
        const grams = this.num(this.grams);
        const ppg = this.num(this.pricePerGram);
        if (!grams || grams <= 0 || ppg === null) return null;
        const making = this.num(this.making) ?? 0;
        return {
          ...common,
          type: 'gold',
          cost: { amount: round2(grams * ppg + making), currency: base },
          details: {
            grams,
            karat: this.karat,
            form: this.goldForm,
            pricePerGram: ppg,
            makingCharge: making || undefined,
          },
        };
      }
      case 'currency': {
        const amount = this.num(this.amount);
        const rate = this.num(this.rate);
        if (!amount || amount <= 0 || !rate || rate <= 0 || this.code === base) return null;
        return {
          ...common,
          type: 'currency',
          cost: { amount: round2(amount * rate), currency: base },
          details: { code: this.code, amount, rate },
        };
      }
      case 'certificate': {
        const principal = this.num(this.principal);
        const rate = this.num(this.annualRate);
        const term = this.termMonths;
        if (!principal || principal <= 0 || rate === null || rate > 100) return null;
        if (!term || !Number.isInteger(term) || term < 1) return null;
        return {
          ...common,
          type: 'certificate',
          cost: { amount: principal, currency: base },
          details: {
            principal,
            annualRate: rate,
            termMonths: term,
            bank: this.bank.trim() || undefined,
          },
        };
      }
      case 'investment': {
        const qty = this.num(this.quantity);
        const buy = this.num(this.buyPrice);
        const symbol = this.symbol.trim();
        if (!qty || qty <= 0 || buy === null || !symbol) return null;
        return {
          ...common,
          type: 'investment',
          cost: { amount: round2(qty * buy), currency: base },
          details: {
            symbol,
            quantity: qty,
            buyPrice: buy,
            currentPrice: this.num(this.currentPrice) ?? undefined,
          },
        };
      }
      default: {
        const paid = this.num(this.paid);
        const value = this.num(this.currentValue);
        if (paid === null || value === null) return null;
        return {
          ...common,
          type: 'other',
          cost: { amount: paid, currency: base },
          details: { currentValue: value },
        };
      }
    }
  }

  get valid(): boolean {
    return !!this.base && this.draft !== null;
  }

  get preview() {
    const d = this.draft;
    if (!d) return null;
    const asset: VaultAsset = {
      ...d,
      id: d.id ?? 'preview',
      ownerUserId: '',
      updatedAt: '',
      synced: 0,
    };
    return valuate(asset, this.base, this.prices, this.goldOverride);
  }

  // ---- formatting -------------------------------------------------------

  nameOf(code: string): string {
    return currencyName(code, this.locale);
  }

  fmt(n: number): string {
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits: 4 }).format(n);
  }

  money(n: number | null): string {
    return formatCurrency(n, this.base, this.locale);
  }

  signed(n: number): string {
    if (Math.abs(n) < 0.005) n = 0;
    return (n > 0 ? '+' : n < 0 ? '−' : '') + formatCurrency(Math.abs(n), this.base, this.locale);
  }

  pct(f: number): string {
    if (f !== null && Math.abs(f) < 0.0005) f = 0;
    return (
      (f > 0 ? '+' : f < 0 ? '−' : '') +
      new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 }).format(Math.abs(f) * 100) +
      '%'
    );
  }

  // ---- actions -----------------------------------------------------------

  cancel(): void {
    void this.modals.dismiss(null, 'cancel');
  }

  async save(): Promise<void> {
    const d = this.draft;
    if (!d || this.saving) return;
    this.saving = true;
    try {
      const saved = await this.vault.save(d);
      await this.modals.dismiss(saved, 'save');
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  async toggleSold(): Promise<void> {
    if (this.status === 'sold') {
      this.status = 'held';
      this.saleAmount = undefined;
      this.soldAt = undefined;
      this.cdr.markForCheck();
      return;
    }
    const alert = await this.alerts.create({
      header: this.translate.instant('VAULT.SOLD_TITLE'),
      message: this.translate.instant('VAULT.SOLD_MESSAGE', { currency: this.base }),
      inputs: [
        {
          name: 'amount',
          type: 'number',
          min: 0,
          value: this.preview?.value != null ? round2(this.preview.value) : undefined,
        },
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        { text: this.translate.instant('VAULT.MARK_SOLD'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    const n = Number(data?.values?.amount);
    if (role === 'confirm' && Number.isFinite(n) && n >= 0) {
      this.status = 'sold';
      this.saleAmount = n;
      this.soldAt = new Date().toISOString();
      this.cdr.markForCheck();
    }
  }

  async confirmDelete(): Promise<void> {
    if (!this.existing) return;
    const alert = await this.alerts.create({
      header: this.translate.instant('VAULT.DELETE_TITLE'),
      message: this.translate.instant('VAULT.DELETE_MESSAGE', { name: this.existing.name }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        { text: this.translate.instant('VAULT.DELETE'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'destructive') {
      await this.vault.remove(this.existing.id);
      await this.modals.dismiss(null, 'delete');
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
