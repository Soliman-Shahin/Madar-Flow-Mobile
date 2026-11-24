import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { clearHttpCache, cacheInterceptor } from './cache.interceptor';

describe('cacheInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const URL = '/api/v1/expenses?page=1';

  beforeEach(() => {
    clearHttpCache();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([cacheInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    clearHttpCache();
  });

  function get(token: string | null, body: object, expectBackend = true) {
    let result: unknown;
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    http.get(URL, { headers }).subscribe((r) => (result = r));
    if (expectBackend) backend.expectOne(URL).flush(body);
    return () => result;
  }

  it('serves the same account from cache within the TTL', () => {
    get('token-A', { total: -10 });
    const second = get('token-A', { total: 'should not be used' }, false);
    expect(second()).toEqual({ total: -10 });
  });

  it('never serves one account the cached data of another account', () => {
    const first = get('token-A', { total: -10 });
    expect(first()).toEqual({ total: -10 });

    // Another account signs in on the same device and requests the same URL.
    const second = get('token-B', { total: 0 });
    expect(second()).toEqual({ total: 0 });
  });

  it('does not share entries between a signed-in and an anonymous request', () => {
    get('token-A', { secret: 'A' });
    const anonymous = get(null, { public: true });
    expect(anonymous()).toEqual({ public: true });
  });

  it('drops everything when the cache is cleared (logout)', () => {
    get('token-A', { total: -10 });
    expect(clearHttpCache()).toBe(1);
    const again = get('token-A', { total: 5 });
    expect(again()).toEqual({ total: 5 });
  });

  it('does not cache mutations', () => {
    http.post(URL, {}).subscribe();
    backend.expectOne(URL).flush({});
    http.post(URL, {}).subscribe();
    backend.expectOne(URL).flush({});
  });
});
