import { Component, OnInit, inject } from '@angular/core';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { BiometricService } from 'src/app/core/services/biometric.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { BiometricSignInService } from 'src/app/modules/auth/services/biometric-signin.service';
import { IonicModule, IonSelect } from '@ionic/angular';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { User } from 'src/app/modules/auth/models';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { PushNotificationService } from 'src/app/core/services/push-notification.service';
import { CacheService } from 'src/app/core/services/cache.service';
import { takeUntil } from 'rxjs/operators';
import { clearHttpCache } from 'src/app/core/interceptors/cache.interceptor';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { UserProfile } from 'src/app/modules/profile/models/profile.model';
import { BRAND } from 'src/app/config/brand.config';

@Component({
  selector: 'app-settings-list',
  templateUrl: './settings-list.component.html',
  styleUrls: ['./settings-list.component.scss'],
  standalone: true,
  imports: [IonicModule, TranslateModule, RouterModule],
})
export class SettingsListComponent extends BaseComponent implements OnInit {
  readonly brand = BRAND;
  biometricAvailable = false;
  biometricSignInAvailable = false;
  biometricEnabled = false;
  biometricSignInEnabled = false;

  currentLanguage = 'en';
  selectedTheme = 'auto';
  lockTimeoutMs = 30_000;
  readonly lockTimeouts = [
    { value: 0, label: 'SETTINGS.LOCK_TIMEOUT_IMMEDIATELY' },
    { value: 30_000, label: 'SETTINGS.LOCK_TIMEOUT_30S' },
    { value: 60_000, label: 'SETTINGS.LOCK_TIMEOUT_1M' },
    { value: 300_000, label: 'SETTINGS.LOCK_TIMEOUT_5M' },
  ];
  notificationsEnabled = true;
  notificationStatus = 'SETTINGS.NOTIFICATIONS_UNAVAILABLE';

  currentUser: User | null = null;
  profile: UserProfile | null = null;

  get displayName(): string {
    return (
      this.profile?.username ||
      this.currentUser?.username ||
      this.currentUser?.fullName ||
      this.translateService.instant('MOBILE_UI.ACCOUNT')
    );
  }

  get displayEmail(): string {
    return this.profile?.email || this.currentUser?.email || '';
  }

  /** One or two letters for the avatar fallback. */
  get initials(): string {
    const source = (
      this.profile?.username ||
      this.currentUser?.username ||
      this.currentUser?.fullName ||
      this.displayEmail ||
      ''
    ).trim();
    if (!source) return '';
    const words = source.split(/[\s@._-]+/).filter(Boolean);
    const letters =
      words.length > 1 ? words[0][0] + words[1][0] : source.slice(0, 1);
    return letters.toUpperCase();
  }
  avatarFailed = false;

  languages = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  ];

  themes = [
    { value: 'light', label: 'SETTINGS.THEME_LIGHT' },
    { value: 'dark', label: 'SETTINGS.THEME_DARK' },
    { value: 'auto', label: 'SETTINGS.THEME_AUTO' },
  ];

  private biometricService = inject(BiometricService);
  private telemetry = inject(TelemetryService);
  telemetryEnabled = false;
  private biometricSignInService = inject(BiometricSignInService);
  private pushNotificationService = inject(PushNotificationService);
  private profileService = inject(ProfileService);

  constructor() {
    super();
  }

  override async ngOnInit() {
    super.ngOnInit();

    // Subscribe to current user changes
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.currentUser = user;
      this.cdr.markForCheck();
    });
    this.profileService.profile$
      .pipe(takeUntil(this.destroy$))
      .subscribe((profile) => {
        this.profile = profile;
        this.avatarFailed = false;
        this.cdr.markForCheck();
      });

    await this.loadSettings();
  }

  onAvatarError(): void {
    this.avatarFailed = true;
  }

  onAvatarLoad(): void {
    this.avatarFailed = false;
  }

  async loadSettings() {
    this.biometricAvailable = await this.biometricService.isAvailable();
    this.biometricSignInAvailable =
      await this.biometricSignInService.isAvailable();
    this.biometricEnabled = this.biometricService.isEnabled;
    this.telemetryEnabled = this.telemetry.isEnabled;
    this.lockTimeoutMs = this.biometricService.lockTimeoutMs;
    this.biometricSignInEnabled = this.biometricSignInAvailable
      ? await this.biometricSignInService.hasEnrollment()
      : false;
    this.currentLanguage = this.currentLang;
    this.selectedTheme = this.themeService.getPreference();
    const notificationPermission =
      await this.pushNotificationService.getCurrentPermissionState();
    this.notificationsEnabled =
      localStorage.getItem('notifications') !== 'false' &&
      notificationPermission === 'granted';
    this.notificationStatus =
      notificationPermission === 'unavailable'
        ? 'SETTINGS.NOTIFICATIONS_UNAVAILABLE'
        : notificationPermission === 'denied'
        ? 'SETTINGS.NOTIFICATIONS_PERMISSION_DENIED_SHORT'
        : this.notificationsEnabled
        ? 'SETTINGS.NOTIFICATIONS_ENABLED'
        : 'SETTINGS.NOTIFICATIONS_DISABLED';
    this.cdr.markForCheck();
  }

  async toggleBiometric(event: any) {
    const isEnabled = event.detail.checked;

    if (isEnabled) {
      if (!this.authService.isLoggedIn) {
        event.target.checked = false;
        return;
      }
      const verified = await this.biometricService.verifyIdentity();
      if (verified) {
        await this.biometricService.setEnabled(true);
        this.biometricEnabled = true;
        this.telemetry.track('biometric_enabled');
      } else {
        event.target.checked = false;
        this.biometricEnabled = false;
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant('SETTINGS.BIOMETRIC_FAILED')
        );
      }
    } else {
      await this.biometricService.setEnabled(false);
      this.biometricEnabled = false;
    }
    this.cdr.markForCheck();
  }

  onLockTimeoutChange(event: any): void {
    const ms = Number(event.detail.value);
    this.biometricService.setLockTimeoutMs(ms);
    this.lockTimeoutMs = this.biometricService.lockTimeoutMs;
    this.cdr.markForCheck();
  }

  override changeLanguage(lang?: string): void {
    const newLang = lang || (this.currentLang === 'ar' ? 'en' : 'ar');
    super.changeLanguage(newLang);
    this.currentLanguage = newLang;
    this.cdr.markForCheck();
  }

  /** Language whose translations are loaded; re-keys the settings lists. */
  renderLang = '';

  protected override onLanguageChanged(lang: string): void {
    this.currentLanguage = lang;
    this.renderLang = lang;
    this.cdr.markForCheck();
  }

  /** Lets the whole row open its select, not just the value on the end. */
  openSelect(select: IonSelect, event: Event): void {
    if ((event.target as HTMLElement | null)?.closest('ion-select')) return;
    select.open(event as UIEvent);
  }

  onLanguageChange(event: any) {
    const lang = event.detail.value;
    this.changeLanguage(lang);
  }

  onThemeChange(event: any) {
    const theme = event.detail.value;
    this.selectedTheme = theme;

    this.themeService.setTheme(theme);
    this.cdr.markForCheck();
  }

  async toggleNotifications(event: any) {
    const requestedEnabled = !!event.detail.checked;
    try {
      if (requestedEnabled) {
        const permission = await this.pushNotificationService.enable();
        this.notificationsEnabled = permission === 'granted';
        if (!this.notificationsEnabled) throw new Error('permission');
      } else {
        await this.pushNotificationService.disable();
        this.notificationsEnabled = false;
      }
    } catch {
      this.notificationsEnabled = false;
      event.target.checked = false;
      this.toastService.presentErrorToast(
        'bottom',
        this.translateService.instant(
          'SETTINGS.NOTIFICATIONS_PERMISSION_DENIED'
        )
      );
    }
    this.cdr.markForCheck();
  }

  async toggleBiometricSignIn(event: any) {
    const enabled = !!event.detail.checked;
    if (enabled) {
      if (!this.authService.isLoggedIn || !this.biometricSignInAvailable) {
        event.target.checked = false;
        return;
      }
      try {
        await this.biometricSignInService.enroll(
          'This device',
          'android',
          this.authService.getCurrentUserId() || undefined
        );
        this.biometricSignInEnabled = true;
      } catch {
        event.target.checked = false;
        this.biometricSignInEnabled = false;
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant('SETTINGS.BIOMETRIC_SIGNIN_FAILED')
        );
      }
    } else {
      try {
        await this.biometricSignInService.revoke();
        this.biometricSignInEnabled = false;
      } catch {
        event.target.checked = true;
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant(
            'SETTINGS.BIOMETRIC_SIGNIN_REVOKE_FAILED'
          )
        );
      }
    }
    this.cdr.markForCheck();
  }

  async toggleTelemetry(event: any): Promise<void> {
    const enabled = !!event.detail.checked;
    if (enabled === this.telemetry.isEnabled) return;
    await this.telemetry.setConsent(enabled);
    this.telemetryEnabled = this.telemetry.isEnabled;
    this.cdr.markForCheck();
  }

  navigateToBackup() {
    this.router.navigate(['/settings/backup']);
  }

  navigateToSync() {
    this.router.navigate(['/settings/sync']);
  }

  navigateToProfile() {
    this.router.navigate(['/profile']);
  }

  navigateToSubscription() {
    const params: any = {};
    params.from = 'settings';
    this.router.navigate(['/subscription'], { queryParams: params });
  }

  async clearCache() {
    const confirmed = await this.alertService.showConfirm({
      title: this.translateService.instant('SETTINGS.CLEAR_CACHE_TITLE'),
      message: this.translateService.instant('SETTINGS.CLEAR_CACHE_MESSAGE'),
    });

    if (confirmed) {
      this.cacheService.clear();
      clearHttpCache();

      this.toastService.presentSuccessToast(
        'bottom',
        this.translateService.instant('SETTINGS.CACHE_CLEARED')
      );
      this.cdr.markForCheck();
    }
  }

  private cacheService = inject(CacheService);
}
