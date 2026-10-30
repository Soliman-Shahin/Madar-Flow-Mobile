import {
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
} from '@angular/common/http';
import { Injectable, inject, NgZone } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Observable, from, EMPTY, throwError, firstValueFrom } from 'rxjs';
import {
  catchError,
  map,
  switchMap,
  finalize,
  shareReplay,
  timeout,
} from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from 'src/environments/environment';
import { AuthResponse, User } from '../models';
import { TokenService } from './token.service';
import { StorageService } from './storage.service';
import { ProfileService } from 'src/app/modules/profile/services/profile.service';
import { EncryptionService } from 'src/app/core/services/encryption.service';
import { ApiService } from 'src/app/core/services/api.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private router = inject(Router);
  private navController = inject(NavController);
  private zone = inject(NgZone);
  private tokenService = inject(TokenService);
  private storageService = inject(StorageService);
  private profileService = inject(ProfileService);
  private encryptionService = inject(EncryptionService);
  private apiService = inject(ApiService);
  private httpBackend = inject(HttpBackend);
  private refreshInFlight?: Observable<{
    accessToken: string;
    refreshToken: string;
  }>;
  private startup?: Promise<void>;
  private loggingOut = false;
  public user = this.tokenService.user;
  public user$ = toObservable(this.user);
  public isLoggedIn$ = this.user$.pipe(map((user) => !!user));
  public redirectUrl: string | null = null;
  get isLoggedIn(): boolean {
    return !!this.tokenService.getAccessToken() && !!this.user();
  }
  get currentUser(): User | null {
    return this.user();
  }
  get userChanges(): Observable<User | null> {
    return this.user$;
  }
  getCurrentUserId(): string | null {
    return this.user()?._id || null;
  }
  getUserId(): string | null {
    return this.getCurrentUserId();
  }
  getRefreshToken(): string | null {
    return this.tokenService.getRefreshToken();
  }

  initializeSession(): Promise<void> {
    return (this.startup ??= (async () => {
      try {
        await this.tokenService.initialize();
        await this.renewIfNeeded();
        this.profileService.hydrateForSession();
      } catch {
        /* Offline or protected storage unavailable: retain recoverable credentials. */
      }
    })());
  }

  async renewIfNeeded(): Promise<void> {
    await this.tokenService.initialize();
    if (!Capacitor.isNativePlatform() && !this.loggingOut) {
      await firstValueFrom(this.refreshAccessToken());
      return;
    }
    if (
      !this.loggingOut &&
      this.tokenService.isAccessTokenExpired() &&
      this.getRefreshToken()
    ) {
      await firstValueFrom(this.refreshAccessToken());
    }
  }

  login(
    email: string,
    password: string,
    persistent = false
  ): Observable<AuthResponse> {
    return this.authenticate('/user/login', { email, password }, persistent);
  }
  loginWithBiometric(
    deviceId: string,
    credential: string,
    expectedUserId?: string
  ): Observable<AuthResponse> {
    return this.authenticate(
      '/user/biometric/signin',
      { deviceId, credential },
      true,
      false,
      expectedUserId
    );
  }
  signup(
    email: string,
    password: string,
    consent: Record<string, unknown>
  ): Observable<AuthResponse> {
    return this.authenticate(
      '/user/signup',
      { email, password, ...consent },
      false
    );
  }
  requestPasswordReset(email: string): Observable<any> {
    return this.apiService.post('/user/password/forgot', { email });
  }
  resetPassword(token: string, password: string): Observable<any> {
    return this.apiService.post('/user/password/reset', { token, password });
  }

  loginWithGoogle(consent?: Record<string, unknown>): Observable<void> {
    const platform = Capacitor.getPlatform?.() || 'web';
    const hasGoogleAuthPlugin = !!(
      (window as any)?.Capacitor?.Plugins?.GoogleAuth ||
      (window as any)?.GoogleAuth
    );

    const isNative =
      (platform === 'android' || platform === 'ios') && hasGoogleAuthPlugin;

    if (isNative) {
      return from(
        (async () => {
          const GA =
            (window as any)?.Capacitor?.Plugins?.GoogleAuth ||
            (window as any)?.GoogleAuth;

          if (!GA) {
            throw new Error('GoogleAuth plugin not available');
          }

          try {
            // Initialize if needed
            if (
              typeof GA.initialize === 'function' &&
              environment.google?.webClientId
            ) {
              try {
                await GA.initialize({
                  clientId: environment.google.webClientId,
                  scopes: ['profile', 'email'],
                  grantOfflineAccess: true,
                });
              } catch (initError) {
                console.warn('Google authentication initialization failed');
              }
            }

            const res = await GA.signIn();
            const idToken: string =
              res?.authentication?.idToken || res?.idToken || '';

            if (!idToken) {
              throw new Error('Failed to obtain Google idToken');
            }

            await this.authenticate(
              `/user/auth/google/native`,
              { idToken, ...(consent || {}) },
              true
            ).toPromise();
            return;
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : 'Unknown error occurred';
            throw new Error(`Google Sign-In failed: ${errorMessage}`);
          }
        })()
      ).pipe(
        map(() => undefined),
        catchError((error) => {
          let errorMessage = 'Network error occurred during Google Sign-In';
          if (error?.status) errorMessage += ` (HTTP ${error.status})`;
          if (error?.message) errorMessage += `: ${error.message}`;
          return throwError(() => new Error(errorMessage));
        })
      );
    }

    // Web: Redirect to backend OAuth (will redirect back to /auth/callback)
    const authUrl = `${environment.browserApiUrl}/user/google${
      consent ? '?consent=1' : ''
    }`;
    window.location.href = authUrl;
    return EMPTY;
  }

  private payload(credentials: Record<string, unknown>): any {
    return environment.enableEncryption
      ? { data: this.encryptionService.encrypt(credentials) }
      : credentials;
  }
  private unwrap(response: any): any {
    if (typeof response?.data === 'string')
      return this.encryptionService.decrypt(response.data);
    return response;
  }
  private authenticate(
    path: string,
    credentials: Record<string, any>,
    persistent = false,
    encrypt = true,
    expectedUserId?: string
  ): Observable<AuthResponse> {
    const baseUrl = Capacitor.isNativePlatform()
      ? environment.nativeApiUrl
      : environment.browserApiUrl;
    const fullUrl = baseUrl + path;
    const payload = encrypt ? this.payload(credentials) : credentials;
    const nativeHttp = Capacitor.isNativePlatform()
      ? (window as any)?.Capacitor?.Plugins?.Http
      : null;
    const request: Observable<any> = nativeHttp?.post
      ? from(
          nativeHttp.post({
            url: fullUrl,
            headers: {
              'Content-Type': 'application/json',
              'X-Client-Platform': Capacitor.getPlatform(),
            },
            data: payload,
          })
        ).pipe(
          map((res: any) => {
            if (res.status >= 400)
              throw new HttpErrorResponse({
                status: res.status,
                error: res.data,
              });
            return res.data;
          })
        )
      : new HttpClient(this.httpBackend).post(fullUrl, payload, {
          withCredentials: true,
          headers: {
            'X-Auth-Transport': 'cookie',
            'X-Auth-Cookie-Path': this.browserAuthCookiePath(),
            'X-Auth-Persistence': persistent ? 'persistent' : 'session',
          },
        });
    return request.pipe(
      timeout(15000),
      switchMap((raw) =>
        from(
          (async () => {
            const response = this.unwrap(raw);
            const data = response?.data;
            const accessToken = data?.tokens?.accessToken ?? data?.accessToken;
            const refreshToken =
              data?.tokens?.refreshToken ?? data?.refreshToken;
            const cookieAuth = !Capacitor.isNativePlatform();
            if (!data?.user || !accessToken || (!cookieAuth && !refreshToken))
              throw new Error('Invalid authentication response');
            if (expectedUserId && data.user._id !== expectedUserId)
              throw new Error(
                'Biometric enrollment belongs to another account'
              );
            this.loggingOut = false;
            try {
              await this.tokenService.saveSession(
                data.user,
                accessToken,
                refreshToken || '',
                persistent
              );
            } catch {
              this.tokenService.removeSession();
              throw new Error('Unable to save session on this device');
            }
            const redirect = this.redirectUrl || '/home';
            this.redirectUrl = null;
            this.zone.run(() => void this.router.navigateByUrl(redirect));
            return response as AuthResponse;
          })()
        )
      )
    );
  }

  refreshAccessToken(): Observable<{
    accessToken: string;
    refreshToken: string;
  }> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const cookieAuth = !Capacitor.isNativePlatform();
    const credential = this.getRefreshToken();
    const revision = this.tokenService.revision;
    if ((!cookieAuth && !credential) || this.loggingOut)
      return throwError(() => new HttpErrorResponse({ status: 401 }));
    const http = new HttpClient(this.httpBackend);
    const baseUrl = Capacitor.isNativePlatform()
      ? environment.nativeApiUrl
      : environment.browserApiUrl;
    const cookiePath = this.browserAuthCookiePath();
    const request = cookieAuth
      ? http
          .get<{ csrfToken: string }>(baseUrl + '/user/csrf-token', {
            withCredentials: true,
            headers: { 'X-Auth-Cookie-Path': cookiePath },
          })
          .pipe(
            switchMap(({ csrfToken }) =>
              http.post<any>(
                baseUrl + '/user/refresh-token',
                this.payload(credential ? { refreshToken: credential } : {}),
                {
                  withCredentials: true,
                  headers: {
                    'X-Auth-Transport': 'cookie',
                    'X-Auth-Cookie-Path': cookiePath,
                    'X-CSRF-Token': csrfToken,
                  },
                }
              )
            )
          )
      : http.post<any>(
          baseUrl + '/user/refresh-token',
          this.payload({ refreshToken: credential })
        );
    this.refreshInFlight = request
      .pipe(
        timeout(15000),
        switchMap((raw) =>
          from(
            (async () => {
              const data = this.unwrap(raw)?.data;
              if (!data?.accessToken || (!cookieAuth && !data?.refreshToken))
                throw new Error('Invalid renewal response');
              if (revision !== this.tokenService.revision)
                throw new Error('Session changed');
              await this.tokenService.updateTokens(
                data.accessToken,
                data.refreshToken || ''
              );
              if (data.user) this.tokenService.setUser(data.user);
              return {
                accessToken: data.accessToken as string,
                refreshToken: (data.refreshToken || '') as string,
              };
            })()
          )
        ),
        catchError((error) => {
          if (
            (error.status === 401 || error.status === 403) &&
            revision === this.tokenService.revision
          )
            this.expireSession();
          return throwError(() => error);
        }),
        finalize(() => (this.refreshInFlight = undefined)),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    return this.refreshInFlight;
  }

  expireSession(): void {
    if (!this.tokenService.getAccessToken() && !this.getRefreshToken()) return;
    this.tokenService.removeSession();
    if (!this.router.url.startsWith('/auth/')) {
      this.redirectUrl = this.router.url;
      void this.router.navigate(['/auth/login']);
    }
  }

  logout(): Observable<void> {
    // Execute even for legacy callers that do not subscribe. Wait only a bounded
    // time for in-flight rotation, then revoke its latest credential if available.
    this.loggingOut = true;
    const task = (async () => {
      try {
        if (this.refreshInFlight)
          await firstValueFrom(this.refreshInFlight.pipe(timeout(3000)));
        const http = new HttpClient(this.httpBackend);
        const baseUrl = Capacitor.isNativePlatform()
          ? environment.nativeApiUrl
          : environment.browserApiUrl;
        const cookiePath = this.browserAuthCookiePath();
        const refreshToken = this.getRefreshToken();
        if (Capacitor.isNativePlatform() && refreshToken) {
          await firstValueFrom(
            http
              .post(
                baseUrl + '/user/logout',
                this.payload({ refreshToken })
              )
              .pipe(timeout(3000))
          );
        } else if (!Capacitor.isNativePlatform()) {
          const { csrfToken } = await firstValueFrom(
            http
              .get<{ csrfToken: string }>(baseUrl + '/user/csrf-token', {
                withCredentials: true,
                headers: { 'X-Auth-Cookie-Path': cookiePath },
              })
              .pipe(timeout(3000))
          );
          await firstValueFrom(
            http
              .post(
                baseUrl + '/user/logout',
                this.payload(refreshToken ? { refreshToken } : {}),
                {
                  withCredentials: true,
                  headers: {
                    'X-Auth-Transport': 'cookie',
                    'X-Auth-Cookie-Path': cookiePath,
                    'X-CSRF-Token': csrfToken,
                  },
                }
              )
              .pipe(timeout(3000))
          );
        }
      } catch {
        /* Local logout must work offline. */
      } finally {
        this.tokenService.removeSession();
        this.storageService.clear();
        // clear() removes the policy marker: restore it before any native reload.
        localStorage.setItem('madarflow_auth_persistent', 'false');
        this.profileService.clearProfile();
        this.redirectUrl = null;
        void this.tokenService.flush().catch(() => undefined);
        await this.navController.navigateRoot('/auth/login', {
          replaceUrl: true,
        });
      }
    })();
    return from(task);
  }

  exchangeGoogleCode(code: string): Observable<void> {
    if (!/^[a-f0-9]{64}$/.test(code)) {
      return throwError(() => new Error('Invalid OAuth exchange code'));
    }
    return new HttpClient(this.httpBackend)
      .post<any>(
        environment.browserApiUrl + '/user/auth/google/exchange',
        { code },
        {
          withCredentials: true,
          headers: {
            'X-Auth-Transport': 'cookie',
            'X-Auth-Cookie-Path': this.browserAuthCookiePath(),
            'X-Auth-Persistence': 'persistent',
          },
        }
      )
      .pipe(
        timeout(15000),
        switchMap((raw) =>
          from(
            (async () => {
              const data = this.unwrap(raw)?.data;
              const accessToken = data?.tokens?.accessToken;
              const refreshToken = data?.tokens?.refreshToken;
              if (!data?.user || !accessToken)
                throw new Error('Invalid OAuth exchange response');
              this.loggingOut = false;
              await this.tokenService.saveSession(
                data.user,
                accessToken,
                refreshToken || '',
                true
              );
            })()
          )
        )
      );
  }

  private browserAuthCookiePath(): string {
    const basePath = new URL(
      environment.browserApiUrl,
      typeof window === 'undefined' ? 'https://madar-flow.invalid' : window.location.origin
    ).pathname.replace(/\/$/, '');
    return `${basePath}/user`;
  }
}
