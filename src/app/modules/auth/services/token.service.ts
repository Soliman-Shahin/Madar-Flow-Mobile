import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { User } from '../models';
import { StorageService } from './storage.service';
import { SecureStorageService } from './secure-storage.service';
import { Subject } from 'rxjs';

interface Session {
  user: User | null;
  accessToken: string;
  refreshToken: string;
}

@Injectable({ providedIn: 'root' })
export class TokenService {
  private readonly sessionEnded = new Subject<void>();
  readonly sessionEnded$ = this.sessionEnded.asObservable();
  user = signal<User | null>(null);
  private session: Session = { user: null, accessToken: '', refreshToken: '' };
  private persistent = false;
  private writes: Promise<void> = Promise.resolve();
  private initialization?: Promise<void>;
  private locked = false;
  private readonly policyKey = 'madarflow_auth_persistent';
  revision = 0;

  constructor(
    private storage: StorageService,
    private secure: SecureStorageService
  ) {}

  initialize(): Promise<void> {
    return (this.initialization ??= this.restore().catch((error) => {
      this.initialization = undefined;
      throw error;
    }));
  }

  private async restore(): Promise<void> {
    const revision = this.revision;
    const policy = localStorage.getItem(this.policyKey);
    if (policy === 'false') return;
    let saved: Session | null = null;
    // A fresh logged-out offline launch has no session to restore. Avoid
    // waiting on native protected-storage discovery in that case; persistent
    // sessions (policy=true) still restore from protected storage offline.
    if (policy === 'true' || navigator.onLine) {
      const raw = await this.secure.read();
      if (raw) saved = JSON.parse(raw);
    }
    if (
      revision !== this.revision ||
      !saved?.accessToken ||
      !saved?.refreshToken ||
      !saved?.user
    )
      return;
    this.persistent = true;
    this.session = saved;
    this.locked =
      Capacitor.isNativePlatform() &&
      policy === 'true' &&
      this.storage.get<boolean>('biometric_enabled') === true;
    if (!this.locked) this.user.set(saved.user);
    this.storage.set('user', saved.user);
    // The browser refresh credential is being migrated to an HttpOnly cookie
    // by AuthService on startup; keep the legacy value in memory for that one
    // exchange, but do not rewrite it to browser storage.
    if (Capacitor.isNativePlatform()) await this.persist();
  }

  async saveSession(
    user: User,
    accessToken: string,
    refreshToken: string,
    persistent: boolean
  ): Promise<void> {
    this.revision++;
    this.persistent = persistent;
    this.locked = false;
    // Preserve the profile cache contract, but never persist password/session fields.
    const {
      password: _password,
      sessions: _sessions,
      ...safeUser
    } = user as User & { password?: unknown; sessions?: unknown };
    user = safeUser as User;
    this.session = { user, accessToken, refreshToken };
    this.storage.set('user', user);
    this.user.set(user);
    await this.persist();
  }

  async updateTokens(accessToken: string, refreshToken: string): Promise<void> {
    this.session = { ...this.session, accessToken, refreshToken };
    await this.persist();
  }

  private persist(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      localStorage.setItem(this.policyKey, 'false');
      return this.secure.clear();
    }
    const persistent = this.persistent;
    const snapshot = JSON.stringify(this.session);
    localStorage.setItem(this.policyKey, String(persistent));
    const write = this.writes
      .catch(() => undefined)
      .then(() =>
        persistent ? this.secure.write(snapshot) : this.secure.clear()
      );
    this.writes = write;
    return write;
  }

  getAccessToken(): string | null {
    return this.locked ? null : this.session.accessToken || null;
  }
  getRefreshToken(): string | null {
    return this.session.refreshToken || null;
  }
  getUser(): User | null {
    return this.locked ? null : this.user();
  }
  getUserId(): string | null {
    return this.locked ? null : this.user()?._id || null;
  }
  isBiometricUnlockRequired(): boolean {
    return this.locked;
  }
  requireBiometricUnlock(): void {
    if (this.hasRestoredSession()) {
      this.locked = true;
      this.user.set(null);
    }
  }
  hasRestoredSession(): boolean {
    return (
      !!this.session.accessToken &&
      (Capacitor.isNativePlatform() ? !!this.session.refreshToken : true) &&
      !!this.session.user
    );
  }
  unlockBiometricSession(): void {
    if (!this.locked || !this.session.user) return;
    this.locked = false;
    this.user.set(this.session.user);
  }
  getUserLang(): string | null {
    return this.storage.get<string>('user-lang');
  }
  setUserLang(value: string): void {
    this.storage.set('user-lang', value);
  }
  setUserId(_value: string): void {} // User ID is owned by the session user.
  setUser(user: User): void {
    this.session.user = user;
    this.user.set(user);
    if (this.session.accessToken)
      void this.persist().catch(() =>
        console.warn('Session storage unavailable')
      );
  }
  setAccessToken(value: string): void {
    this.session.accessToken = value;
  }
  setRefreshToken(value: string): void {
    this.session.refreshToken = value;
  }
  setSession(_id: string, accessToken: string, refreshToken: string): void {
    void this.updateTokens(accessToken, refreshToken).catch(() =>
      console.warn('Session storage unavailable')
    );
  }
  removeSession(): void {
    this.revision++;
    this.persistent = false;
    this.locked = false;
    this.session = { user: null, accessToken: '', refreshToken: '' };
    this.user.set(null);
    this.sessionEnded.next();
    this.storage.remove('user');
    this.storage.remove('biometric_enabled');
    void this.persist().catch(() =>
      console.warn('Session storage cleanup unavailable')
    );
  }
  async flush(): Promise<void> {
    await this.writes;
  }
  getPayload(): any {
    try {
      return this.decode(this.getAccessToken()!).data ?? null;
    } catch {
      return null;
    }
  }
  private decode(token: string): any {
    return JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
  }
  isTokenExpired(token: string | null): boolean {
    try {
      const exp = this.decode(token!).exp;
      return !exp || Date.now() / 1000 >= exp - 30;
    } catch {
      return true;
    }
  }
  isAccessTokenExpired(): boolean {
    return this.isTokenExpired(this.getAccessToken());
  }
  // Refresh credentials are opaque: only the server can determine expiry/revocation.
  isRefreshTokenExpired(): boolean {
    return !this.getRefreshToken();
  }
}
