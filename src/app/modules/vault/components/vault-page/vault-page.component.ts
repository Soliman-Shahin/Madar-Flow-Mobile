import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { AlertController, IonicModule, ModalController, RefresherCustomEvent } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { CurrencySheetComponent } from 'src/app/shared/components/prompt-sheets/currency-sheet.component';
import { PlanLimitBannerComponent } from 'src/app/shared/components/plan-limit-banner/plan-limit-banner.component';
import { ledgerDetailSheet, ledgerFormSheet } from 'src/app/shared/ui/sheet/sheet-options';
import { formatCurrency, suggestCurrency } from 'src/app/shared/utils';
import { VaultService } from 'src/app/core/vault/vault.service';
import { ASSET_META, ASSET_TYPES, VAULT_CURRENCIES, currencyName, formatNumber } from 'src/app/core/vault/vault-meta';
import {
  GoldPriceOverride,
  convert,
  perGram24From,
  goldPerGram24,
  maturityDate,
  totals,
  valuate,
} from 'src/app/core/vault/vault-valuation';
import {
  AssetType,
  CertificateDetails,
  CurrencyDetails,
  GoldDetails,
  InvestmentDetails,
  MarketPrices,
  Valuation,
  VaultAsset,
} from 'src/app/core/vault/vault.types';
import { AssetFormComponent } from '../asset-form/asset-form.component';

interface Row {
  asset: VaultAsset;
  valuation: Valuation;
  subtitle: string;
}

/**
 * The vault: everything the person has saved, what it is worth today in their
 * own currency, and what it has gained or lost since they bought it.
 */
@Component({
  selector: 'app-vault-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonicModule, TranslateModule, PlanLimitBannerComponent],
  styleUrls: ['./vault-page.component.scss'],
  templateUrl: './vault-page.component.html',
})
export class VaultPageComponent implements OnInit, OnDestroy {
  private readonly vault = inject(VaultService);
  private readonly profile = inject(ProfileService);
  private readonly modals = inject(ModalController);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private sub?: Subscription;

  readonly types = ASSET_TYPES;
  readonly meta = ASSET_META;

  base = '';
  loading = true;
  filter: AssetType | 'all' = 'all';
  view: 'savings' | 'prices' = 'savings';
  fxQuery = '';
  pricesBusy = false;

  assets: VaultAsset[] = [];
  prices: MarketPrices | null = null;
  usage: { used: number; limit: number | null } | null = null;

  rows: Row[] = [];
  shown: Row[] = [];
  summary = totals([], '', null);
  soldCount = 0;
  override: GoldPriceOverride | null = null;

  private get locale(): string {
    return this.translate.currentLang || 'en';
  }

  ngOnInit(): void {
    this.override = this.vault.goldOverride;
    this.sub = combineLatest([
      this.vault.assets$,
      this.vault.prices$,
      this.vault.usage$,
      this.profile.profile$,
    ]).subscribe(([assets, prices, usage, profile]) => {
      this.assets = assets;
      this.prices = prices;
      this.usage = usage;
      this.base = profile?.currency ?? '';
      this.recompute();
    });
    void this.refresh();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  ionViewWillEnter(): void {
    void this.vault.load().then(() => {
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  private async refresh(force = false): Promise<void> {
    this.pricesBusy = true;
    this.cdr.markForCheck();
    await this.vault.load();
    this.loading = false;
    await Promise.all([this.vault.refreshPrices(force), this.vault.sync()]);
    this.pricesBusy = false;
    this.cdr.markForCheck();
  }

  async onRefresh(ev: RefresherCustomEvent): Promise<void> {
    await this.refresh(true);
    ev.target.complete();
  }

  // ---- derived view ------------------------------------------------------

  private recompute(): void {
    const base = this.base;
    this.summary = totals(this.assets, base, this.prices, this.override);
    this.rows = this.assets.map((asset) => ({
      asset,
      valuation: valuate(asset, base, this.prices, this.override),
      subtitle: this.subtitleOf(asset),
    }));
    this.soldCount = this.rows.filter((r) => r.asset.status === 'sold').length;
    this.applyFilter();
  }

  private applyFilter(): void {
    this.shown = this.rows.filter(
      (r) => this.filter === 'all' || r.asset.type === this.filter
    );
    this.cdr.markForCheck();
  }

  setFilter(f: AssetType | 'all'): void {
    this.filter = f;
    this.applyFilter();
  }

  /** Kinds the person actually has, so the filter never offers an empty one. */
  get presentTypes(): AssetType[] {
    return this.types.filter((t) => this.rows.some((r) => r.asset.type === t));
  }

  get hasHeld(): boolean {
    return this.rows.some((r) => r.asset.status === 'held');
  }

  get limitPercent(): number {
    const u = this.usage;
    if (!u || u.limit === null || u.limit <= 0) return 0;
    return Math.min(100, Math.round((u.used / u.limit) * 100));
  }

  get atLimit(): boolean {
    const l = this.usage?.limit;
    return l != null && this.assets.length >= l;
  }

  private subtitleOf(a: VaultAsset): string {
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    const n = (v: number, max = 2) => formatNumber(v, this.locale, max);
    switch (a.type) {
      case 'gold': {
        const d = a.details as GoldDetails;
        return t('VAULT.SUB_GOLD', {
          grams: n(d.grams, 3),
          karat: d.karat,
          form: t('VAULT.FORM_' + d.form),
        });
      }
      case 'currency': {
        const d = a.details as CurrencyDetails;
        return t('VAULT.SUB_CURRENCY', { amount: n(d.amount), code: d.code });
      }
      case 'certificate': {
        const d = a.details as CertificateDetails;
        const end = maturityDate(a.purchasedAt, d.termMonths);
        const date = new Intl.DateTimeFormat(this.locale, {
          month: 'short',
          year: 'numeric',
        }).format(end);
        return t('VAULT.SUB_CERT', { rate: n(d.annualRate, 2), date });
      }
      case 'investment': {
        const d = a.details as InvestmentDetails;
        return t('VAULT.SUB_INVEST', { qty: n(d.quantity, 4), symbol: d.symbol });
      }
      default:
        return a.note ?? t('VAULT.TYPE_other');
    }
  }

  // ---- formatting ---------------------------------------------------------

  money(n: number | null): string {
    return formatCurrency(n, this.base, this.locale);
  }

  /** Keeps an amount in one piece inside a right-to-left sentence. */
  isolate(text: string): string {
    return `⁦${text}⁩`;
  }

  signed(n: number): string {
    if (Math.abs(n) < 0.005) n = 0;
    return (
      (n > 0 ? '+' : n < 0 ? '−' : '') +
      formatCurrency(Math.abs(n), this.base, this.locale)
    );
  }

  pct(f: number | null): string {
    if (f !== null && Math.abs(f) < 0.0005) f = 0;
    if (f === null) return '';
    return (
      (f > 0 ? '+' : f < 0 ? '−' : '') +
      new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 }).format(Math.abs(f) * 100) +
      '%'
    );
  }

  share(f: number): string {
    return new Intl.NumberFormat(this.locale, { style: 'percent', maximumFractionDigits: 0 }).format(f);
  }

  get pricesAge(): string | null {
    const p = this.prices;
    if (!p) return null;
    const mins = Math.max(0, Math.round((Date.now() - new Date(p.updatedAt).getTime()) / 60000));
    if (mins < 2) return this.translate.instant('VAULT.PRICES_NOW');
    if (mins < 60) return this.translate.instant('VAULT.PRICES_MIN', { n: mins });
    if (mins < 60 * 24) return this.translate.instant('VAULT.PRICES_HOURS', { n: Math.round(mins / 60) });
    return this.translate.instant('VAULT.PRICES_DAYS', { n: Math.round(mins / 1440) });
  }

  get goldPriceLine(): string | null {
    const p = goldPerGram24(this.base, this.prices, this.override);
    if (p === null) return null;
    return this.translate.instant('VAULT.GOLD_LINE', { price: this.isolate(this.money(p)) });
  }

  // ---- actions ------------------------------------------------------------

  async chooseCurrency(): Promise<void> {
    const modal = await this.modals.create({
      component: CurrencySheetComponent,
      componentProps: { suggested: suggestCurrency(), locale: this.locale },
      backdropDismiss: true,
      ...ledgerDetailSheet(),
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<string | null>();
    if (role === 'save' && data) {
      this.profile.updateProfile({ currency: data }).subscribe();
    }
  }

  async add(): Promise<void> {
    if (this.atLimit) {
      await this.showLimit();
      return;
    }
    await this.open();
  }

  async edit(row: Row): Promise<void> {
    await this.open(row.asset);
  }

  private async open(existing?: VaultAsset): Promise<void> {
    if (!this.base) {
      await this.chooseCurrency();
      return;
    }
    const modal = await this.modals.create({
      component: AssetFormComponent,
      componentProps: {
        existing,
        base: this.base,
        prices: this.prices,
        goldOverride: this.override,
        initialType: this.filter === 'all' ? 'gold' : this.filter,
      },
      ...ledgerFormSheet(),
    });
    await modal.present();
    await modal.onDidDismiss();
    await this.vault.refreshUsage();
  }

  private async showLimit(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.translate.instant('VAULT.LIMIT_TITLE'),
      message: this.translate.instant('VAULT.LIMIT_MESSAGE', {
        limit: this.usage?.limit ?? this.assets.length,
      }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        { text: this.translate.instant('SUBSCRIPTION.UPGRADE'), role: 'upgrade' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'upgrade') void this.router.navigate(['/subscription']);
  }

  /** The person's own price for a gram of 24-karat gold; empty clears it. */
  /** Drops the person's own gold price and goes back to the live market price. */
  useMarketPrice(): void {
    this.override = null;
    this.vault.goldOverride = null;
    this.recompute();
  }

  async setGoldPrice(): Promise<void> {
    // 1. which karat the price is for (21 is what most people know by heart)
    const pick = await this.alerts.create({
      header: this.translate.instant('VAULT.GOLD_KARAT_TITLE'),
      inputs: [24, 22, 21, 18, 14].map((k) => ({
        type: 'radio' as const,
        label: this.translate.instant('VAULT.KARAT_N', { k }),
        value: k,
        checked: k === (this.override?.karat ?? 21),
      })),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        ...(this.override
          ? [{ text: this.translate.instant('VAULT.USE_MARKET'), role: 'clear' }]
          : []),
        { text: this.translate.instant('VAULT.NEXT'), role: 'confirm' },
      ],
    });
    await pick.present();
    const first = await pick.onDidDismiss();
    if (first.role === 'clear') {
      this.override = null;
      this.vault.goldOverride = null;
      this.recompute();
      return;
    }
    const karat = Number(first.data?.values);
    if (first.role !== 'confirm' || !Number.isFinite(karat)) return;

    // 2. the price of one gram of that karat
    const market = goldPerGram24(this.base, this.prices, null);
    const marketK = market !== null ? Math.round(((market * karat) / 24) * 100) / 100 : undefined;
    const same = this.override?.karat === karat ? this.override.entered : undefined;
    const alert = await this.alerts.create({
      header: this.translate.instant('VAULT.GOLD_PRICE_TITLE'),
      message: this.translate.instant('VAULT.GOLD_PRICE_MESSAGE', { currency: this.base, karat }),
      inputs: [
        {
          name: 'price',
          type: 'number',
          min: 0,
          value: same,
          placeholder: marketK !== undefined ? String(marketK) : undefined,
        },
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        { text: this.translate.instant('VAULT.SAVE'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role === 'confirm') {
      const n = Number(data?.values?.price);
      if (Number.isFinite(n) && n > 0) {
        this.override = {
          perGram24: perGram24From(n, karat),
          currency: this.base,
          karat,
          entered: n,
        };
        this.vault.goldOverride = this.override;
      }
    }
    this.recompute();
  }

  get goldRows(): Array<{ key: number | string; label: string; price: number }> {
    const p24 = goldPerGram24(this.base, this.prices, this.override);
    if (p24 === null) return [];
    const rows: Array<{ key: number | string; label: string; price: number }> = [24, 22, 21, 18, 14].map((k) => ({
      key: k,
      label: this.translate.instant('VAULT.KARAT_N', { k }),
      price: (p24 * k) / 24,
    }));
    rows.push({ key: 'pound', label: this.translate.instant('VAULT.GOLD_POUND'), price: 8 * (21 / 24) * p24 });
    return rows;
  }

  get fxRows(): Array<{ code: string; name: string; rate: number }> {
    const usd = this.prices?.usdPer;
    if (!usd) return [];
    const q = this.fxQuery.trim().toLowerCase();
    const out: Array<{ code: string; name: string; rate: number }> = [];
    for (const code of VAULT_CURRENCIES) {
      if (code === this.base) continue;
      const rate = convert(1, code, this.base, usd);
      if (rate === null) continue;
      const name = currencyName(code, this.locale);
      if (q && !code.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) continue;
      out.push({ code, name, rate });
    }
    return out;
  }

  setFxQuery(v: string): void {
    this.fxQuery = v;
    this.cdr.markForCheck();
  }

  trackRow = (_: number, r: Row) => r.asset.id;

}
