import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, startWith } from 'rxjs';
import {
  AppSettingsService,
  isOlderVersion,
  pickLocalized,
} from 'src/app/core/services/app-settings.service';

type Notice = {
  id: string;
  tone: 'warning' | 'info';
  message: string;
  /** Store link for update notices. */
  actionUrl?: string;
};

/**
 * Non-blocking notice driven by the dashboard: a maintenance message, or an
 * update prompt when the installed native version is behind. It never blocks
 * the app (a mistaken setting must not lock users out) and can be dismissed
 * until the content changes or the app restarts.
 */
@Component({
  selector: 'app-notice',
  standalone: true,
  imports: [IonicModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as n) {
    <aside
      class="mf-notice"
      [class.mf-notice--warning]="n.tone === 'warning'"
      role="status"
      aria-live="polite"
    >
      <ion-icon
        [name]="
          n.tone === 'warning' ? 'construct-outline' : 'arrow-up-circle-outline'
        "
        aria-hidden="true"
      ></ion-icon>
      <p class="mf-notice__text">{{ n.message }}</p>
      @if (n.actionUrl) {
      <button
        type="button"
        class="mf-notice__action"
        (click)="open(n.actionUrl)"
      >
        {{ 'APP_NOTICE.UPDATE_ACTION' | translate }}
      </button>
      }
      <button
        type="button"
        class="mf-notice__close"
        [attr.aria-label]="'COMMON.CLOSE' | translate"
        (click)="dismiss(n.id)"
      >
        <ion-icon name="close" aria-hidden="true"></ion-icon>
      </button>
    </aside>
    }
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset-inline: var(--mf-gutter);
        bottom: calc(var(--mf-tabbar-clearance, 0px) + var(--mf-space-2));
        z-index: 900;
        pointer-events: none;
      }
      .mf-notice {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: var(--mf-space-3);
        max-width: 560px;
        margin-inline: auto;
        padding: var(--mf-space-3) var(--mf-space-3) var(--mf-space-3)
          var(--mf-space-4);
        border-radius: var(--mf-radius-lg);
        background: var(--mf-surface-raised);
        box-shadow: 0 12px 32px -8px rgb(16 24 40 / 0.35),
          inset 0 0 0 1px var(--mf-separator);
        font-family: var(--mf-font-sans);
        color: var(--mf-ink);
      }
      .mf-notice > ion-icon {
        flex: 0 0 auto;
        font-size: 22px;
        color: var(--mf-primary);
      }
      .mf-notice--warning > ion-icon {
        color: var(--mf-warning);
      }
      .mf-notice__text {
        flex: 1 1 auto;
        margin: 0;
        min-width: 0;
        font-size: var(--mf-text-callout);
        line-height: var(--mf-leading-snug);
        overflow-wrap: anywhere;
      }
      .mf-notice__action {
        flex: 0 0 auto;
        min-height: 36px;
        padding: 0 var(--mf-space-3);
        border: 0;
        border-radius: var(--mf-radius-md);
        background: var(--mf-primary-soft);
        font: inherit;
        font-size: var(--mf-text-footnote);
        font-weight: var(--mf-weight-semibold);
        color: var(--mf-primary);
        cursor: pointer;
      }
      .mf-notice__close {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: var(--mf-radius-pill);
        background: transparent;
        color: var(--mf-ink-3);
        cursor: pointer;
      }
      .mf-notice__action:focus-visible,
      .mf-notice__close:focus-visible {
        outline: 2px solid var(--mf-focus-ring);
        outline-offset: 2px;
      }
    `,
  ],
})
export class AppNoticeComponent implements OnInit {
  private readonly settings = inject(AppSettingsService);
  private readonly translate = inject(TranslateService);

  private readonly lang = toSignal(
    this.translate.onLangChange.pipe(
      map((event) => event.lang),
      startWith(this.translate.currentLang || 'en')
    ),
    { initialValue: 'en' }
  );
  /** Installed native version (null on the web, where there is no store). */
  private readonly installed = signal<string | null>(null);
  private readonly dismissed = signal<ReadonlySet<string>>(new Set());

  readonly notice = computed<Notice | null>(() => {
    const lang = this.lang();
    const revision = this.settings.settings()?.revision ?? 0;

    const maintenance = this.settings.maintenance();
    const message = pickLocalized(maintenance?.message, lang);
    if (maintenance?.enabled && message) {
      return { id: `maintenance:${revision}`, tone: 'warning', message };
    }

    const installed = this.installed();
    const versioning = this.settings.versioning();
    if (installed && versioning) {
      const required =
        !!versioning.minVersion &&
        isOlderVersion(installed, versioning.minVersion);
      const available =
        !!versioning.latestVersion &&
        isOlderVersion(installed, versioning.latestVersion);
      if (required || available) {
        return {
          id: `${required ? 'required' : 'available'}:${
            versioning.latestVersion ?? versioning.minVersion
          }`,
          tone: 'info',
          message: this.translate.instant(
            required
              ? 'APP_NOTICE.UPDATE_REQUIRED'
              : 'APP_NOTICE.UPDATE_AVAILABLE'
          ),
          actionUrl: versioning.storeUrl,
        };
      }
    }
    return null;
  });

  /** The current notice unless the user already dismissed it. */
  readonly shown = computed(() => {
    const n = this.notice();
    return n && !this.dismissed().has(n.id) ? n : null;
  });

  ngOnInit(): void {
    if (Capacitor.isNativePlatform()) {
      void App.getInfo()
        .then((info) => this.installed.set(info.version))
        .catch(() => undefined);
    }
  }

  dismiss(id: string): void {
    this.dismissed.update((set) => new Set(set).add(id));
  }

  open(url: string): void {
    // The link was validated as https when the settings were loaded.
    window.open(url, '_blank', 'noopener');
  }
}
