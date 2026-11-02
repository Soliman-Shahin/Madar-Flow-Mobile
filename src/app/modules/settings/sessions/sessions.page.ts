import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { ApiService } from 'src/app/core/services/api.service';
import { BaseComponent } from 'src/app/shared/base/base.component';

interface ActiveSession {
  id: string;
  platform: 'web' | 'android' | 'ios';
  /** Short label such as "Chrome on Windows"; absent for sessions created before it was recorded. */
  device?: string | null;
  createdAt: string | null;
  lastAuthenticatedAt: string | null;
  expiresAt: number;
  current: boolean;
}

@Component({
  selector: 'app-sessions-page',
  standalone: true,
  imports: [IonicModule, TranslateModule, RouterLink],
  templateUrl: './sessions.page.html',
  styleUrls: ['./sessions.page.scss'],
})
export class SessionsPage extends BaseComponent implements OnInit {
  private readonly api = inject(ApiService);

  sessions: ActiveSession[] = [];
  loading = true;
  error = false;
  busyId: string | null = null;
  revokingOthers = false;

  get currentSession(): ActiveSession | undefined {
    return this.sessions.find((s) => s.current);
  }

  get others(): ActiveSession[] {
    return this.sessions.filter((s) => !s.current);
  }

  override ngOnInit(): void {
    super.ngOnInit();
    this.load();
  }

  load(done?: () => void): void {
    this.loading = true;
    this.error = false;
    this.api.get<{ sessions: ActiveSession[] }>('/user/sessions').subscribe({
      next: ({ sessions }) => {
        this.sessions = sessions || [];
        this.loading = false;
        this.cdr.markForCheck();
        done?.();
      },
      error: () => {
        this.error = true;
        this.loading = false;
        this.cdr.markForCheck();
        done?.();
      },
    });
  }

  refresh(event: Event): void {
    this.load(() => (event as CustomEvent).detail?.complete?.());
  }

  async revoke(session: ActiveSession): Promise<void> {
    if (this.busyId) return;
    const confirmed = await this.alertService.showConfirm({
      title: this.translateService.instant('SETTINGS.REVOKE_SESSION'),
      message: this.translateService.instant('SETTINGS.REVOKE_SESSION_CONFIRM'),
      confirmText: this.translateService.instant('SETTINGS.REVOKE_SESSION'),
      cssClass: 'alert-delete',
    });
    if (!confirmed) return;
    this.busyId = session.id;
    this.api.delete(`/user/sessions/${encodeURIComponent(session.id)}`).subscribe({
      next: () => {
        // Drop it at once; the reload then confirms what the server has.
        this.sessions = this.sessions.filter((s) => s.id !== session.id);
        this.busyId = null;
        this.load();
      },
      error: () => {
        this.busyId = null;
        this.cdr.markForCheck();
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant('SETTINGS.SESSIONS_ACTION_ERROR')
        );
      },
    });
  }

  async revokeOthers(): Promise<void> {
    if (this.revokingOthers) return;
    const confirmed = await this.alertService.showConfirm({
      title: this.translateService.instant('SETTINGS.SIGN_OUT_OTHER_SESSIONS'),
      message: this.translateService.instant(
        'SETTINGS.SIGN_OUT_OTHER_SESSIONS_CONFIRM'
      ),
      confirmText: this.translateService.instant(
        'SETTINGS.SIGN_OUT_OTHER_SESSIONS'
      ),
      cssClass: 'alert-delete',
    });
    if (!confirmed) return;
    this.revokingOthers = true;
    this.api.delete('/user/sessions/others').subscribe({
      next: () => {
        this.sessions = this.sessions.filter((s) => s.current);
        this.revokingOthers = false;
        this.load();
      },
      error: () => {
        this.revokingOthers = false;
        this.cdr.markForCheck();
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant('SETTINGS.SESSIONS_ACTION_ERROR')
        );
      },
    });
  }

  icon(platform: ActiveSession['platform']): string {
    return platform === 'web' ? 'globe-outline' : 'phone-portrait-outline';
  }

  /** The device label when known, else the platform name ("Android device"). */
  title(session: ActiveSession): string {
    return (
      session.device ||
      this.translateService.instant(
        `SETTINGS.SESSION_PLATFORM_${session.platform.toUpperCase()}`
      )
    );
  }

  date(value: string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat(this.currentLang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  /** "5 minutes ago", in the app language. */
  relative(value: string | null): string {
    if (!value) return '—';
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(this.currentLang, { numeric: 'auto' });
    const abs = Math.abs(seconds);
    if (abs < 60) return rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    return rtf.format(Math.round(seconds / 86400), 'day');
  }
}
