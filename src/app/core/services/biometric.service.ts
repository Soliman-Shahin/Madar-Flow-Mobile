import { Injectable, inject } from '@angular/core';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Platform } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { StorageService } from '../../modules/auth/services/storage.service';

@Injectable({
  providedIn: 'root',
})
export class BiometricService {
  private readonly BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
  private readonly LOCK_TIMEOUT_KEY = 'biometric_lock_timeout_ms';
  /** Allowed idle periods before the app locks again, in milliseconds. */
  static readonly LOCK_TIMEOUT_OPTIONS = [0, 30_000, 60_000, 300_000] as const;
  static readonly DEFAULT_LOCK_TIMEOUT = 30_000;
  public lastBiometricTime = 0;

  private platform = inject(Platform);
  private storage = inject(StorageService);
  private translate = inject(TranslateService);

  get isEnabled(): boolean {
    return !!this.storage.get(this.BIOMETRIC_ENABLED_KEY);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.storage.set(this.BIOMETRIC_ENABLED_KEY, enabled);
  }

  /**
   * How long the app may stay in the background before it asks for the
   * biometric again. 0 locks immediately. Unknown stored values fall back to
   * the default so a corrupted setting can never disable the lock.
   */
  get lockTimeoutMs(): number {
    const stored = Number(this.storage.get(this.LOCK_TIMEOUT_KEY));
    return (BiometricService.LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(
      stored
    ) && this.storage.get(this.LOCK_TIMEOUT_KEY) !== null
      ? stored
      : BiometricService.DEFAULT_LOCK_TIMEOUT;
  }

  setLockTimeoutMs(ms: number): void {
    if (!(BiometricService.LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(ms)) {
      return;
    }
    this.storage.set(this.LOCK_TIMEOUT_KEY, ms);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.platform.is('capacitor')) {
      // Mock availability for web testing
      return true;
    }
    try {
      const result = await NativeBiometric.isAvailable();
      return result.isAvailable;
    } catch (e) {
      console.error('Biometric availability check failed', e);
      return false;
    }
  }

  async verifyIdentity(
    reason: string = 'Please authenticate to continue'
  ): Promise<boolean> {
    if (!this.platform.is('capacitor')) {
      // Simulate biometric prompt on web
      return new Promise((resolve) => {
        const confirmed = window.confirm(
          `[Web Simulation] Biometric Scan Required\n\n${reason}\n\nClick OK to simulate a successful fingerprint/face scan.`
        );
        resolve(confirmed);
      });
    }

    try {
      const result = await NativeBiometric.verifyIdentity({
        reason: reason,
        title: this.translate.instant('BIOMETRIC_PROMPT.TITLE'),
        subtitle: this.translate.instant('BIOMETRIC_PROMPT.SUBTITLE'),
        description: reason,
      });
      this.lastBiometricTime = Date.now();
      return true;
    } catch (e) {
      console.error('Biometric verification failed', e);
      this.lastBiometricTime = Date.now();
      return false;
    }
  }
}
