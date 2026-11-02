import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import {
  ActionSheetController,
  AlertController,
  IonicModule,
} from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { ConnectionService } from 'src/app/core/services/connection.service';
import { ReceiptPrefsService } from 'src/app/core/receipts/receipt-prefs.service';
import { TranslateModule } from '@ngx-translate/core';
import {
  ReceiptScanService,
  ScanResult,
  ScanStage,
} from 'src/app/core/receipts/receipt-scan.service';

/**
 * The "scan a receipt" strip at the top of the new-transaction form.
 * Three states: the call to action, a quiet progress line while reading, and
 * a summary of what was read (with the small picture) that can be removed.
 * It never saves anything: the form shows the fields for review.
 */
@Component({
  selector: 'app-receipt-scan',
  standalone: true,
  imports: [IonicModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rs" [attr.aria-busy]="busy">
      @if (busy) {
      <div class="rs__busy" role="status" aria-live="polite">
        <ion-spinner name="crescent" aria-hidden="true"></ion-spinner>
        <div class="rs__busy-text">
          <strong>{{ stageKey | translate }}</strong>
          @if (stage === 'reading') {
          <div class="rs__bar" aria-hidden="true">
            <i [style.width.%]="progress * 100"></i>
          </div>
          }
        </div>
      </div>
      } @if (result && !busy) {
      <div class="rs__done">
        <img [src]="result.thumb" alt="" class="rs__thumb" />
        <div class="rs__done-text">
          <strong>{{ 'RECEIPT.READ' | translate }}</strong>
          <small>{{
            (result.extraction.source === 'online'
              ? 'RECEIPT.CHECK_FIELDS'
              : 'RECEIPT.CHECK_FIELDS_DEVICE'
            ) | translate
          }}</small>
        </div>
        <button
          type="button"
          class="rs__remove"
          (click)="clear()"
          [attr.aria-label]="'RECEIPT.REMOVE' | translate"
        >
          <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
        </button>
      </div>
      @if (currencyMismatch) {
      <p class="rs__note" role="note">
        {{
          'RECEIPT.CURRENCY_DIFF'
            | translate
              : { receipt: result.extraction.currency, app: currency }
        }}
      </p>
      } } @if (error) {
      <p class="rs__error" role="alert">{{ error | translate }}</p>
      }
      <input
        #camera
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        (change)="onFile($event)"
      />
      <input
        #gallery
        type="file"
        accept="image/*"
        hidden
        (change)="onFile($event)"
      />
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .rs {
        margin: 0 var(--mf-gutter) var(--mf-space-3);
        font-family: var(--mf-font-sans);
      }
      .rs__cta {
        display: flex;
        align-items: center;
        gap: var(--mf-space-3);
        width: 100%;
        min-height: 56px;
        padding: var(--mf-space-3) var(--mf-space-4);
        border: 1px solid var(--mf-outline);
        border-radius: var(--mf-radius-lg);
        background: var(--mf-surface);
        text-align: start;
        font: inherit;
        color: var(--mf-ink);
        cursor: pointer;
      }
      .rs__cta:active {
        background: var(--mf-surface-sunken);
      }
      .rs__cta ion-icon {
        flex: none;
        font-size: 26px;
        color: var(--mf-primary);
      }
      .rs__cta-text {
        display: grid;
        gap: 2px;
      }
      .rs__cta-text strong {
        font-size: var(--mf-text-callout);
        font-weight: var(--mf-weight-semibold);
      }
      .rs__cta-text small,
      .rs__done-text small {
        font-size: var(--mf-text-footnote);
        color: var(--mf-ink-2);
      }
      .rs__done-text small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rs__link {
        display: block;
        margin: 0 auto;
        min-height: var(--mf-touch-target);
        padding: 0 var(--mf-space-3);
        border: 0;
        background: transparent;
        font: inherit;
        font-size: var(--mf-text-footnote);
        font-weight: var(--mf-weight-medium);
        color: var(--mf-primary);
        cursor: pointer;
      }
      .rs__busy,
      .rs__done {
        display: flex;
        align-items: center;
        gap: var(--mf-space-3);
        min-height: 48px;
        padding: var(--mf-space-2) var(--mf-space-3);
        border-radius: var(--mf-radius-lg);
        background: var(--mf-surface);
        box-shadow: inset 0 0 0 1px var(--mf-separator);
      }
      .rs__busy-text,
      .rs__done-text {
        display: grid;
        gap: 4px;
        min-width: 0;
        flex: 1;
      }
      .rs__busy-text strong,
      .rs__done-text strong {
        font-size: var(--mf-text-callout);
        font-weight: var(--mf-weight-semibold);
        color: var(--mf-ink);
      }
      .rs__busy ion-spinner {
        flex: none;
        color: var(--mf-primary);
      }
      .rs__bar {
        height: 4px;
        overflow: hidden;
        border-radius: var(--mf-radius-pill);
        background: var(--mf-surface-sunken);
      }
      .rs__bar i {
        display: block;
        height: 100%;
        background: var(--mf-primary);
        transition: width 200ms linear;
      }
      .rs__thumb {
        flex: none;
        width: 30px;
        height: 38px;
        object-fit: cover;
        border-radius: var(--mf-radius-sm);
        background: var(--mf-surface-sunken);
      }
      .rs__remove {
        flex: none;
        display: grid;
        place-items: center;
        width: var(--mf-touch-target);
        height: var(--mf-touch-target);
        margin-inline-end: -8px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        font-size: 22px;
        color: var(--mf-ink-2);
        cursor: pointer;
      }
      .rs__note,
      .rs__error {
        margin: var(--mf-space-2) var(--mf-space-1) 0;
        font-size: var(--mf-text-footnote);
        line-height: var(--mf-leading-snug);
        color: var(--mf-ink-2);
      }
      .rs__error {
        color: var(--mf-danger);
      }
      button:focus-visible {
        outline: 2px solid var(--mf-focus-ring);
        outline-offset: 2px;
      }
    `,
  ],
})
export class ReceiptScanComponent {
  private readonly scanner = inject(ReceiptScanService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly alerts = inject(AlertController);
  private readonly sheets = inject(ActionSheetController);
  @ViewChild('camera') private cameraInput?: ElementRef<HTMLInputElement>;
  @ViewChild('gallery') private galleryInput?: ElementRef<HTMLInputElement>;
  private readonly translate = inject(TranslateService);
  private readonly prefs = inject(ReceiptPrefsService);
  private readonly connection = inject(ConnectionService);

  /** The currency the app shows amounts in. */
  @Input() currency = '';
  @Output() scanned = new EventEmitter<ScanResult>();
  @Output() cleared = new EventEmitter<void>();

  busy = false;
  stage: ScanStage = 'preparing';
  progress = 0;
  result: ScanResult | null = null;
  error = '';

  /** Camera or gallery: opened from the "Scan" button in the form header. */
  async openPicker(): Promise<void> {
    if (this.busy) return;
    const t = (k: string) => this.translate.instant(k);
    const sheet = await this.sheets.create({
      header: t('RECEIPT.SCAN'),
      buttons: [
        {
          text: t('RECEIPT.TAKE_PHOTO'),
          icon: 'camera-outline',
          handler: () => this.cameraInput?.nativeElement.click(),
        },
        {
          text: t('RECEIPT.FROM_GALLERY'),
          icon: 'images-outline',
          handler: () => this.galleryInput?.nativeElement.click(),
        },
        { text: t('COMMON.CANCEL'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  get stageKey(): string {
    return this.stage === 'reading'
      ? 'RECEIPT.READING_DEVICE'
      : this.stage === 'online'
      ? 'RECEIPT.READING'
      : 'RECEIPT.PREPARING';
  }

  get currencyMismatch(): boolean {
    const r = this.result?.extraction.currency;
    return !!r && !!this.currency && r !== this.currency.toUpperCase();
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy) return;
    await this.askConsentOnce();
    this.error = '';
    this.busy = true;
    this.progress = 0;
    this.cdr.markForCheck();
    try {
      const result = await this.scanner.scan(file, {
        onStage: (s) => {
          this.stage = s;
          this.cdr.markForCheck();
        },
        onProgress: (p) => {
          this.progress = p;
          this.cdr.markForCheck();
        },
      });
      const e = result.extraction;
      if (e.total === undefined && !e.merchant && !e.date) {
        this.error = 'RECEIPT.NOT_FOUND';
      } else {
        this.result = result;
        this.scanned.emit(result);
      }
    } catch {
      this.error = 'RECEIPT.FAILED';
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  /** Asked once, the first time a scan could use the online reader. */
  private async askConsentOnce(): Promise<void> {
    if (this.prefs.onlineReading !== null || !this.connection.isOnline()) return;
    const t = (k: string) => this.translate.instant(k);
    const alert = await this.alerts.create({
      header: t('RECEIPT.CONSENT_TITLE'),
      message: t('RECEIPT.CONSENT_MESSAGE'),
      backdropDismiss: false,
      buttons: [
        { text: t('RECEIPT.CONSENT_DEVICE'), role: 'device' },
        { text: t('RECEIPT.CONSENT_ONLINE'), role: 'online' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    this.prefs.onlineReading = role === 'online' ? 'on' : 'off';
  }

  clear(): void {
    this.result = null;
    this.error = '';
    this.cleared.emit();
    this.cdr.markForCheck();
  }
}
