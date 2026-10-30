import { Component, OnInit, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { ApiService } from 'src/app/core/services/api.service';
import { BaseComponent } from 'src/app/shared/base/base.component';

interface ActiveSession {
  id: string;
  platform: 'web' | 'android' | 'ios';
  createdAt: string | null;
  lastAuthenticatedAt: string | null;
  expiresAt: number;
  current: boolean;
}

@Component({
  selector: 'app-sessions-page',
  standalone: true,
  imports: [IonicModule, TranslateModule],
  template: `
    <ion-header mode="ios"><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/settings"></ion-back-button></ion-buttons>
      <ion-title>{{ 'SETTINGS.ACTIVE_SESSIONS' | translate }}</ion-title>
    </ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <p class="sessions-intro">{{ 'SETTINGS.ACTIVE_SESSIONS_DESC' | translate }}</p>
      @if (loading) { <ion-spinner aria-label="Loading"></ion-spinner> }
      @else if (error) {
        <ion-item lines="none"><ion-label class="ion-text-wrap">{{ 'SETTINGS.SESSIONS_LOAD_ERROR' | translate }}</ion-label></ion-item>
        <ion-button fill="outline" (click)="load()">{{ 'COMMON.RETRY' | translate }}</ion-button>
      } @else if (!sessions.length) {
        <ion-item lines="none"><ion-label>{{ 'SETTINGS.NO_SESSIONS' | translate }}</ion-label></ion-item>
      } @else {
        <ion-list inset>
          @for (session of sessions; track session.id) {
            <ion-item lines="full">
              <ion-icon slot="start" [name]="icon(session.platform)" aria-hidden="true"></ion-icon>
              <ion-label class="ion-text-wrap">
                <h2>{{ platformName(session.platform) | translate }}
                  @if (session.current) { <ion-badge color="primary">{{ 'SETTINGS.CURRENT_SESSION' | translate }}</ion-badge> }
                </h2>
                <p>{{ 'SETTINGS.SESSION_LAST_AUTHENTICATED' | translate }}: {{ date(session.lastAuthenticatedAt) }}</p>
                <p>{{ 'SETTINGS.SESSION_EXPIRES' | translate }}: {{ expiry(session.expiresAt) }}</p>
              </ion-label>
              @if (!session.current) {
                <ion-button slot="end" fill="clear" color="danger" [disabled]="busyId === session.id" (click)="revoke(session)">
                  {{ 'SETTINGS.REVOKE_SESSION' | translate }}
                </ion-button>
              }
            </ion-item>
          }
        </ion-list>
        @if (sessions.some(s => !s.current)) {
          <ion-button expand="block" fill="outline" color="danger" [disabled]="revokingOthers" (click)="revokeOthers()">
            {{ 'SETTINGS.SIGN_OUT_OTHER_SESSIONS' | translate }}
          </ion-button>
        }
      }
    </ion-content>
  `,
  styles: [`
    .sessions-intro { color: var(--ion-color-medium); line-height: 1.55; }
    ion-list { margin-block: 1rem; }
    ion-badge { margin-inline-start: .4rem; vertical-align: middle; font-size: .7rem; }
    ion-item h2 { font-weight: 600; }
    ion-item p { margin-top: .3rem; }
  `],
})
export class SessionsPage extends BaseComponent implements OnInit {
  private readonly api = inject(ApiService);
  sessions: ActiveSession[] = [];
  loading = true;
  error = false;
  busyId: string | null = null;
  revokingOthers = false;

  override ngOnInit(): void { super.ngOnInit(); this.load(); }

  load(): void {
    this.loading = true;
    this.error = false;
    this.api.get<{ sessions: ActiveSession[] }>('/user/sessions').subscribe({
      next: ({ sessions }) => { this.sessions = sessions || []; this.loading = false; },
      error: () => { this.error = true; this.loading = false; },
    });
  }

  async revoke(session: ActiveSession): Promise<void> {
    const confirmed = await this.alertService.showConfirm({
      title: this.translateService.instant('SETTINGS.REVOKE_SESSION'),
      message: this.translateService.instant('SETTINGS.REVOKE_SESSION_CONFIRM'),
    });
    if (!confirmed) return;
    this.busyId = session.id;
    this.api.delete(`/user/sessions/${encodeURIComponent(session.id)}`).subscribe({
      next: () => { this.busyId = null; this.load(); },
      error: () => { this.busyId = null; this.toastService.presentErrorToast('bottom', this.translateService.instant('SETTINGS.SESSIONS_ACTION_ERROR')); },
    });
  }

  async revokeOthers(): Promise<void> {
    const confirmed = await this.alertService.showConfirm({
      title: this.translateService.instant('SETTINGS.SIGN_OUT_OTHER_SESSIONS'),
      message: this.translateService.instant('SETTINGS.SIGN_OUT_OTHER_SESSIONS_CONFIRM'),
    });
    if (!confirmed) return;
    this.revokingOthers = true;
    this.api.delete('/user/sessions/others').subscribe({
      next: () => { this.revokingOthers = false; this.load(); },
      error: () => { this.revokingOthers = false; this.toastService.presentErrorToast('bottom', this.translateService.instant('SETTINGS.SESSIONS_ACTION_ERROR')); },
    });
  }

  icon(platform: ActiveSession['platform']): string {
    return platform === 'web' ? 'globe-outline' : platform === 'ios' ? 'phone-portrait-outline' : 'phone-portrait-outline';
  }
  platformName(platform: ActiveSession['platform']): string { return `SETTINGS.SESSION_PLATFORM_${platform.toUpperCase()}`; }
  date(value: string | null): string { return value ? new Intl.DateTimeFormat(this.currentLang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
  expiry(value: number): string { return new Intl.DateTimeFormat(this.currentLang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value * 1000)); }
}
