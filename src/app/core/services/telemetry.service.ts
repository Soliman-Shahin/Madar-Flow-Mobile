import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { TokenService } from 'src/app/modules/auth/services/token.service';
import { StorageService } from 'src/app/modules/auth/services/storage.service';

/** Mirrors the backend's fixed list; nothing outside it can be sent. */
export type TelemetryEventName =
  | 'app_open'
  | 'signup_completed'
  | 'transaction_added'
  | 'category_added'
  | 'export_completed'
  | 'sync_completed'
  | 'biometric_enabled';

export type TelemetryConsent = 'granted' | 'declined';

interface QueuedEvent {
  name: TelemetryEventName;
  ts: number;
}

const MAX_QUEUE = 100;
const BATCH_SIZE = 25;
const FLUSH_DELAY_MS = 30_000;
const FLUSH_AT = 10;
/** One "app opened" per half hour, so quick app switching is not counted. */
const APP_OPEN_THROTTLE_MS = 30 * 60 * 1000;

const UUID_V4 = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/**
 * Anonymous usage events, sent only after the user explicitly opts in.
 *
 * - Nothing is recorded, queued or sent without consent.
 * - Events carry a fixed name, a timestamp and a random install id. No account
 *   id, no amounts, no free text. The install id is created when the user opts
 *   in and deleted (together with the server-side events) when they opt out.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly api = inject(ApiService);
  private readonly tokens = inject(TokenService);
  private readonly storage = inject(StorageService);
  private readonly translate = inject(TranslateService);

  private readonly CONSENT_KEY = 'telemetry_consent';
  private readonly INSTALL_KEY = 'telemetry_install_id';
  private readonly QUEUE_KEY = 'telemetry_queue';
  private readonly ERASE_KEY = 'telemetry_pending_erase';
  private readonly LAST_OPEN_KEY = 'telemetry_last_open';

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;

  get consent(): TelemetryConsent | null {
    const value = this.storage.get<string>(this.CONSENT_KEY);
    return value === 'granted' || value === 'declined' ? value : null;
  }

  get isEnabled(): boolean {
    return this.consent === 'granted';
  }

  /** True until the user has answered the consent question once. */
  get needsPrompt(): boolean {
    return this.consent === null;
  }

  async setConsent(granted: boolean): Promise<void> {
    if (granted) {
      if (!this.installId) this.storage.set(this.INSTALL_KEY, UUID_V4());
      this.storage.set(this.CONSENT_KEY, 'granted');
      return;
    }

    const installId = this.installId;
    this.storage.set(this.CONSENT_KEY, 'declined');
    this.storage.remove(this.QUEUE_KEY);
    this.storage.remove(this.INSTALL_KEY);
    this.storage.remove(this.LAST_OPEN_KEY);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (installId) {
      // Ask the server to erase what it already holds; retry later if offline.
      this.storage.set(this.ERASE_KEY, installId);
      await this.processPendingErase();
    }
  }

  /** Record an event. A no-op unless the user has opted in. */
  track(name: TelemetryEventName): void {
    if (!this.isEnabled || !this.installId) return;
    const queue = this.readQueue();
    queue.push({ name, ts: Date.now() });
    this.storage.set(this.QUEUE_KEY, queue.slice(-MAX_QUEUE));
    if (queue.length >= FLUSH_AT) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** "App opened", at most once every 30 minutes. */
  trackAppOpen(now = Date.now()): void {
    if (!this.isEnabled) return;
    const last = Number(this.storage.get<number>(this.LAST_OPEN_KEY) ?? 0);
    if (now - last < APP_OPEN_THROTTLE_MS) return;
    this.storage.set(this.LAST_OPEN_KEY, now);
    this.track('app_open');
  }

  /** Send queued events (batched). Failures keep the queue for the next try. */
  flush(): Promise<void> {
    // Callers that arrive mid-flight wait for the same run instead of skipping.
    if (!this.inflight) {
      this.inflight = this.doFlush().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async doFlush(): Promise<void> {
    await this.processPendingErase();
    if (!this.isEnabled) return;
    const installId = this.installId;
    if (!installId || !this.canSend()) return;

    try {
      let queue = this.readQueue();
      while (queue.length) {
        const batch = queue.slice(0, BATCH_SIZE);
        await firstValueFrom(
          this.api.post('/telemetry/events', {
            installId,
            appVersion: await this.appVersion(),
            platform: this.platform(),
            lang: this.lang(),
            events: batch.map((e) => ({ name: e.name, ts: e.ts })),
          })
        );
        // Re-read: new events may have been queued while the request ran.
        queue = this.readQueue().slice(batch.length);
        this.storage.set(this.QUEUE_KEY, queue);
      }
    } catch {
      /* offline or rejected: keep the queue, try again later */
    }
  }

  private async processPendingErase(): Promise<void> {
    const installId = this.storage.get<string>(this.ERASE_KEY);
    if (!installId || !this.canSend()) return;
    try {
      await firstValueFrom(
        this.api.delete('/telemetry/events', { body: { installId } })
      );
      this.storage.remove(this.ERASE_KEY);
    } catch {
      /* keep it and retry on the next flush */
    }
  }

  private get installId(): string | null {
    return this.storage.get<string>(this.INSTALL_KEY);
  }

  private readQueue(): QueuedEvent[] {
    const raw = this.storage.get<QueuedEvent[]>(this.QUEUE_KEY);
    return Array.isArray(raw) ? raw : [];
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  /** The endpoint needs a signed-in session and a network. */
  private canSend(): boolean {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    return online && !!this.tokens.getUserId();
  }

  private platform(): 'android' | 'ios' | 'web' {
    const p = Capacitor.getPlatform();
    return p === 'android' || p === 'ios' ? p : 'web';
  }

  private lang(): 'ar' | 'en' {
    return (this.translate.currentLang || 'en').startsWith('ar') ? 'ar' : 'en';
  }

  private async appVersion(): Promise<string> {
    if (!Capacitor.isNativePlatform()) return 'web';
    try {
      const info = await App.getInfo();
      return /^[0-9A-Za-z.+-]{1,20}$/.test(info.version) ? info.version : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
