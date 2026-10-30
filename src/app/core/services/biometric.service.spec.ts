import { TestBed } from '@angular/core/testing';
import { Platform } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { BiometricService } from './biometric.service';

describe('BiometricService auto-lock timeout', () => {
  let service: BiometricService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [{ provide: Platform, useValue: { is: () => false } }],
    });
    service = TestBed.inject(BiometricService);
  });

  afterEach(() => localStorage.clear());

  it('defaults to the 30 second grace period when nothing is stored', () => {
    expect(service.lockTimeoutMs).toBe(30_000);
  });

  it('stores and returns every supported timeout, including immediate lock', () => {
    for (const ms of BiometricService.LOCK_TIMEOUT_OPTIONS) {
      service.setLockTimeoutMs(ms);
      expect(service.lockTimeoutMs).toBe(ms);
    }
  });

  it('ignores unsupported values so the lock cannot be weakened by bad input', () => {
    service.setLockTimeoutMs(60_000);
    service.setLockTimeoutMs(24 * 60 * 60 * 1000);
    service.setLockTimeoutMs(-1);
    service.setLockTimeoutMs(Number.NaN);
    expect(service.lockTimeoutMs).toBe(60_000);
  });

  it('falls back to the default when the stored value is corrupt', () => {
    localStorage.setItem('madarflow_biometric_lock_timeout_ms', '"forever"');
    expect(service.lockTimeoutMs).toBe(30_000);
    localStorage.setItem('madarflow_biometric_lock_timeout_ms', '999999999');
    expect(service.lockTimeoutMs).toBe(30_000);
  });
});
