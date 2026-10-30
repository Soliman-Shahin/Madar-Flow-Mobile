import {
  TestBed,
  fakeAsync,
  flushMicrotasks,
} from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { NavController, ToastController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { ProfileService } from '../../profile/services/profile.service';
import { authInterceptor } from '../helper/authInterceptor';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { environment } from 'src/environments/environment';

const user = { _id: 'web-user', email: 'web@example.test' } as any;
const jwt = (seconds: number) =>
  'header.' +
  btoa(JSON.stringify({ exp: Date.now() / 1000 + seconds })) +
  '.signature';
const api = (path: string) => environment.browserApiUrl + path;

/**
 * Browser transport: the refresh credential lives in an HttpOnly cookie, so the
 * app never sees or stores it, and rotation/logout carry a CSRF token.
 * (The native contract is pinned in auth-session.spec.ts.)
 */
describe('AUTH.1 browser cookie sessions', () => {
  let auth: AuthService;
  let tokens: TokenService;
  let requests: HttpTestingController;
  let router: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    router = {
      url: '/home',
      navigate: jasmine.createSpy().and.resolveTo(true),
      navigateByUrl: jasmine.createSpy().and.resolveTo(true),
    };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor, authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: NavController, useValue: { navigateRoot: router.navigateByUrl } },
        { provide: ProfileService, useValue: { clearProfile: jasmine.createSpy() } },
        {
          provide: ToastController,
          useValue: {
            create: async () => ({ present: async () => {}, setAttribute: () => {} }),
          },
        },
      ],
    });
    auth = TestBed.inject(AuthService);
    tokens = TestBed.inject(TokenService);
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    requests.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('sign-in uses the cookie transport and never keeps a refresh token in the page', fakeAsync(() => {
    auth.login(user.email, 'synthetic-password', true).subscribe();
    const login = requests.expectOne(api('/user/login'));
    expect(login.request.withCredentials).toBeTrue();
    expect(login.request.headers.get('X-Auth-Transport')).toBe('cookie');
    expect(login.request.headers.get('X-Auth-Persistence')).toBe('persistent');
    login.flush({ success: true, data: { user, accessToken: jwt(3600) } });
    flushMicrotasks();

    expect(auth.isLoggedIn).toBeTrue();
    expect(tokens.getRefreshToken()).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('synthetic-password');
  }));

  it('renews through a CSRF token and accepts a response without a refresh token', fakeAsync(() => {
    void tokens.saveSession(user, jwt(10), '', false);
    flushMicrotasks();

    let renewed = '';
    auth.refreshAccessToken().subscribe((r) => (renewed = r.accessToken));
    requests.expectOne(api('/user/csrf-token')).flush({ csrfToken: 'csrf-one' });
    flushMicrotasks();

    const refresh = requests.expectOne(api('/user/refresh-token'));
    expect(refresh.request.withCredentials).toBeTrue();
    expect(refresh.request.headers.get('X-CSRF-Token')).toBe('csrf-one');
    expect(refresh.request.headers.get('X-Auth-Transport')).toBe('cookie');
    const fresh = jwt(7200);
    refresh.flush({ success: true, data: { accessToken: fresh, user } });
    flushMicrotasks();

    expect(renewed).toBe(fresh);
    expect(tokens.getAccessToken()).toBe(fresh);
    expect(tokens.getRefreshToken()).toBeNull();
  }));

  it('an expired cookie session ends the local session', fakeAsync(() => {
    void tokens.saveSession(user, jwt(10), '', false);
    flushMicrotasks();

    auth.refreshAccessToken().subscribe({ error: () => {} });
    requests.expectOne(api('/user/csrf-token')).flush({ csrfToken: 'csrf-two' });
    flushMicrotasks();
    requests
      .expectOne(api('/user/refresh-token'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();

    expect(auth.isLoggedIn).toBeFalse();
  }));

  it('logout asks the server to clear the cookie with a CSRF token, then clears locally', fakeAsync(() => {
    void tokens.saveSession(user, jwt(3600), '', false);
    flushMicrotasks();

    auth.logout().subscribe();
    flushMicrotasks();
    requests.expectOne(api('/user/csrf-token')).flush({ csrfToken: 'csrf-three' });
    flushMicrotasks();
    const logout = requests.expectOne(api('/user/logout'));
    expect(logout.request.headers.get('X-CSRF-Token')).toBe('csrf-three');
    expect(logout.request.withCredentials).toBeTrue();
    logout.flush({ success: true });
    flushMicrotasks();

    expect(auth.isLoggedIn).toBeFalse();
    expect(tokens.getAccessToken()).toBeNull();
  }));

  it('logout still signs out locally when the server cannot be reached', fakeAsync(() => {
    void tokens.saveSession(user, jwt(3600), '', false);
    flushMicrotasks();

    auth.logout().subscribe();
    flushMicrotasks();
    requests
      .expectOne(api('/user/csrf-token'))
      .flush({}, { status: 503, statusText: 'Unavailable' });
    flushMicrotasks();

    expect(auth.isLoggedIn).toBeFalse();
  }));
});
