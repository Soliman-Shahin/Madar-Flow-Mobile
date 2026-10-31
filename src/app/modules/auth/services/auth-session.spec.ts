import { Component } from '@angular/core';
import {
  TestBed,
  fakeAsync,
  flushMicrotasks,
  tick,
} from '@angular/core/testing';
import {
  provideHttpClient,
  withInterceptors,
  HttpClient,
} from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController, NavController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Capacitor } from '@capacitor/core';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { of } from 'rxjs';
import { SessionLifecycleService } from '../../../core/services/session-lifecycle.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { StorageService } from './storage.service';
import { SecureStorageService } from './secure-storage.service';
import { EncryptionService } from '../../../core/services/encryption.service';
import { ProfileService } from '../../profile/services/profile.service';
import { authInterceptor } from '../helper/authInterceptor';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { LoginComponent } from '../components/login/login.component';
import { UiInputComponent } from '../../../shared/ui/ui-input/ui-input.component';
import { environment } from 'src/environments/environment';

const user = { _id: 'test-user', email: 'person@example.test' } as any;
const jwt = (seconds: number) =>
  'header.' +
  btoa(JSON.stringify({ exp: Date.now() / 1000 + seconds })) +
  '.signature';
const endpoint = environment.nativeApiUrl + '/expenses';
const refreshUrl = environment.nativeApiUrl + '/user/refresh-token';

@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonicModule,
    UiInputComponent,
    TranslateModule,
  ],
  template:
    '<form [formGroup]="form"><app-ui-input [errorsAfterTouch]="true" formControlName="email" type="email"/><app-ui-input formControlName="password" type="password"/><button [disabled]="form.invalid">Login</button></form>',
})
class LoginHarnessComponent {
  form!: FormGroup;
}

/** Native persistence goes through SecureStorageService, whose real storage loads a lazy
 *  plugin chunk that never resolves under Karma. Keep it in memory for every instance. */
let savedSecure: string | null = null;
function mockSecureStorage() {
  savedSecure = null;
  spyOn(SecureStorageService.prototype, 'write').and.callFake(async (value) => {
    savedSecure = value;
  });
  spyOn(SecureStorageService.prototype, 'read').and.callFake(async () => savedSecure);
  spyOn(SecureStorageService.prototype, 'clear').and.callFake(async () => {
    savedSecure = null;
  });
}

describe('AUTH.1 consumer sessions', () => {
  // These cases pin the native transport contract (refresh token in the body, persisted
  // session). The browser uses an HttpOnly cookie instead and is covered separately.
  beforeEach(() => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    mockSecureStorage();
  });
  let auth: AuthService;
  let tokens: TokenService;
  let http: HttpClient;
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
      // errorInterceptor -> ToastService needs the translation service.
      imports: [TranslateModule.forRoot()],
      providers: [
        provideHttpClient(
          withInterceptors([errorInterceptor, authInterceptor])
        ),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        {
          provide: NavController,
          useValue: { navigateRoot: router.navigateByUrl },
        },
        {
          provide: ProfileService,
          useValue: { clearProfile: jasmine.createSpy() },
        },
        {
          provide: ToastController,
          useValue: {
            create: async () => ({
              present: async () => {},
              setAttribute: () => {},
            }),
          },
        },
      ],
    });
    auth = TestBed.inject(AuthService);
    tokens = TestBed.inject(TokenService);
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    requests.verify();
    localStorage.clear();
    sessionStorage.clear();
  });
  function seed(seconds = 3600, persistent = false) {
    void tokens.saveSession(user, jwt(seconds), 'refresh-one', persistent);
    flushMicrotasks();
  }
  function respondRefresh() {
    requests.expectOne(refreshUrl).flush({
      success: true,
      data: { accessToken: jwt(7200), refreshToken: 'refresh-two' },
    });
    flushMicrotasks();
  }

  it('restores valid persistent access without a refresh', fakeAsync(() => {
    seed(3600, true);
    const cold = new TokenService(
      new StorageService(),
      new SecureStorageService()
    );
    void cold.initialize();
    flushMicrotasks();
    expect(cold.getAccessToken()).toBe(tokens.getAccessToken());
    void auth.initializeSession();
    flushMicrotasks();
    requests.expectNone(refreshUrl);
    expect(auth.isLoggedIn).toBeTrue();
  }));
  it('refreshes expired access during startup before discarding the session', fakeAsync(() => {
    seed(-100, true);
    void auth.initializeSession();
    flushMicrotasks();
    respondRefresh();
    expect(tokens.getRefreshToken()).toBe('refresh-two');
    expect(auth.isLoggedIn).toBeTrue();
  }));
  it('preserves a recoverable session on transient startup failure', fakeAsync(() => {
    seed(-100, true);
    void auth.initializeSession();
    flushMicrotasks();
    requests
      .expectOne(refreshUrl)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    flushMicrotasks();
    expect(tokens.getRefreshToken()).toBe('refresh-one');
    expect(router.navigate).not.toHaveBeenCalled();
  }));
  it('renews on resume when access is near expiry', fakeAsync(() => {
    seed(10);
    void auth.renewIfNeeded();
    flushMicrotasks();
    respondRefresh();
    expect(tokens.isAccessTokenExpired()).toBeFalse();
  }));
  it('shares one refresh for concurrent 401s and retries both requests', fakeAsync(() => {
    seed();
    let completed = 0;
    http.get(endpoint + '/one').subscribe(() => completed++);
    http.get(endpoint + '/two').subscribe(() => completed++);
    for (const req of requests.match((r) => r.url.startsWith(endpoint))) {
      expect(req.request.headers.has('refresh-token')).toBeFalse();
      req.flush(
        { error: { code: 'AUTH_INVALID_TOKEN' } },
        { status: 401, statusText: 'Unauthorized' }
      );
    }
    const renewal = requests.expectOne(refreshUrl);
    expect(
      TestBed.inject(EncryptionService).decrypt(renewal.request.body.data)
    ).toEqual({ refreshToken: 'refresh-one' });
    renewal.flush({
      success: true,
      data: { accessToken: jwt(7200), refreshToken: 'refresh-two' },
    });
    flushMicrotasks();
    const retried = requests.match((r) => r.url.startsWith(endpoint));
    expect(retried.length).toBe(2);
    retried.forEach((req) => {
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer ' + tokens.getAccessToken()
      );
      req.flush({});
    });
    flushMicrotasks();
    expect(completed).toBe(2);
  }));
  it('does not let an old request clear a newly signed-in session', fakeAsync(() => {
    seed();
    http.get(endpoint).subscribe({ error: () => {} });
    const oldRequest = requests.expectOne(endpoint);
    void tokens.saveSession(user, jwt(7200), 'new-login-refresh', false);
    flushMicrotasks();
    oldRequest.flush(
      { error: { code: 'AUTH_USER_INACTIVE' } },
      { status: 401, statusText: 'Unauthorized' }
    );
    flushMicrotasks();
    expect(tokens.getRefreshToken()).toBe('new-login-refresh');
    expect(router.navigate).not.toHaveBeenCalled();
  }));
  it('does not loop if the retried request is still unauthorized', fakeAsync(() => {
    seed();
    http.get(endpoint).subscribe({ error: () => {} });
    requests
      .expectOne(endpoint)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    respondRefresh();
    requests
      .expectOne(endpoint)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();
    requests.expectNone(refreshUrl);
    expect(tokens.getRefreshToken()).toBeNull();
  }));
  it('does not logout or refresh on 403', fakeAsync(() => {
    seed();
    http.get(endpoint).subscribe({ error: () => {} });
    requests
      .expectOne(endpoint)
      .flush({}, { status: 403, statusText: 'Forbidden' });
    flushMicrotasks();
    expect(tokens.getRefreshToken()).toBe('refresh-one');
    expect(router.navigate).not.toHaveBeenCalled();
    requests.expectNone(refreshUrl);
  }));
  it('clears invalid refresh and redirects once', fakeAsync(() => {
    seed();
    auth.refreshAccessToken().subscribe({ error: () => {} });
    requests
      .expectOne(refreshUrl)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();
    expect(tokens.getRefreshToken()).toBeNull();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/auth/login']);
  }));
  it('never attaches credentials to another origin or a lookalike API path', fakeAsync(() => {
    seed();
    for (const url of [
      'https://example.test/data',
      environment.nativeApiUrl + '-other/data',
    ]) {
      http.get(url).subscribe();
      const req = requests.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBeFalse();
      expect(req.request.headers.has('refresh-token')).toBeFalse();
      req.flush({});
    }
  }));
  it('Remember Me OFF works now but has no session after cold launch', fakeAsync(() => {
    seed(3600, false);
    expect(auth.isLoggedIn).toBeTrue();
    const cold = new TokenService(
      new StorageService(),
      new SecureStorageService()
    );
    void cold.initialize();
    flushMicrotasks();
    expect(cold.getRefreshToken()).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('refresh-one');
  }));
  it('login persists credentials, never the raw password', fakeAsync(() => {
    auth.login(user.email, 'synthetic-password-never-save', true).subscribe();
    requests.expectOne(environment.nativeApiUrl + '/user/login').flush({
      success: true,
      data: {
        user: { ...user, password: 'synthetic-password-never-save' },
        accessToken: jwt(3600),
        refreshToken: 'refresh-one',
      },
    });
    flushMicrotasks();
    expect(JSON.stringify(localStorage)).not.toContain(
      'synthetic-password-never-save'
    );
    expect(tokens.getRefreshToken()).toBe('refresh-one');
  }));
  it('logout clears locally even when server revocation is unavailable', fakeAsync(() => {
    seed(3600, true);
    auth.logout().subscribe();
    requests
      .expectOne(environment.nativeApiUrl + '/user/logout')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    flushMicrotasks();
    expect(tokens.getRefreshToken()).toBeNull();
    expect(localStorage.getItem('madarflow_auth_session_v1')).toBeNull();
  }));
});

describe('AUTH.1 native protected storage', () => {
  it('stores the session through the installed native protected credential API', async () => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    const set = jasmine.createSpy().and.resolveTo();
    const storage = new SecureStorageService();
    (storage as any).native = {
      setCredentials: set,
      isCredentialsSaved: jasmine.createSpy().and.resolveTo({ isSaved: true }),
      getCredentials: jasmine
        .createSpy()
        .and.resolveTo({ username: 'session', password: 'session-bundle' }),
    };
    await storage.write('session-bundle');
    expect(set).toHaveBeenCalledWith({
      server: 'com.orbitmadar.madarflow.auth.session.v1',
      username: 'session',
      password: 'session-bundle',
    });
    expect(await storage.read()).toBe('session-bundle');
  });
});

describe('AUTH.1 Login validity', () => {
  it('enables submit from input events without blur and retains saved email on entry', async () => {
    localStorage.setItem('savedEmail', 'saved@example.test');
    const login: any = Object.create(LoginComponent.prototype);
    login.formFields = {
      email: 'email',
      password: 'password',
      rememberMe: 'rememberMe',
    };
    login.initForm();
    login.loading = { next: () => {} };
    login.errorMessage = { next: () => {} };
    // Collaborators used by refreshBiometricSignInAvailability (the instance is
    // created without DI, so they must be stubbed or the promise rejects unhandled).
    login.platform = { ready: () => Promise.resolve('dom') };
    login.biometricSignInService = {
      isAvailable: () => Promise.resolve(false),
      hasEnrollment: () => Promise.resolve(false),
    };
    login.cdr = { markForCheck: () => {} };
    login.ionViewWillEnter();
    expect(login.loginForm.value.email).toBe('saved@example.test');
    TestBed.configureTestingModule({
      imports: [LoginHarnessComponent, TranslateModule.forRoot()],
    });
    const fixture = TestBed.createComponent(LoginHarnessComponent);
    fixture.componentInstance.form = login.loginForm;
    fixture.detectChanges();
    await fixture.whenStable();
    const inputs = fixture.nativeElement.querySelectorAll('ion-input');
    inputs[0].dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: 'valid@example.test' } })
    );
    inputs[1].dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: 'valid-password' } })
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBeFalse();
    expect(login.loginForm.get('password').touched).toBeFalse();
    localStorage.clear();
  });
});

describe('AUTH.1 logout orchestration', () => {
  it('continues auth logout when auxiliary teardown stalls', fakeAsync(() => {
    const logout = jasmine.createSpy().and.returnValue(of(undefined));
    const lifecycle = new SessionLifecycleService(
      { logout } as any,
      { deactivateCurrentDevice: () => new Promise(() => {}) } as any
    );
    lifecycle.logout().subscribe();
    tick(3001);
    expect(logout).toHaveBeenCalledTimes(1);
  }));
});
