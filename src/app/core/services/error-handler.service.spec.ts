import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { ErrorHandlerService } from './error-handler.service';
import { ToastService } from '../../shared/services/toast.service';

describe('ErrorHandlerService', () => {
  let service: ErrorHandlerService;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('toast', ['presentErrorToast', 'presentWarningToast']);
    toast.presentErrorToast.and.resolveTo();
    toast.presentWarningToast.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: TranslateService, useValue: { instant: (k: string) => `t:${k}` } },
      ],
    });
    service = TestBed.inject(ErrorHandlerService);
    spyOn(console, 'error');
    spyOnProperty(navigator, 'onLine').and.returnValue(true);
  });

  const lastMessage = () => toast.presentErrorToast.calls.mostRecent().args[1];

  it('shows a generic message for client-side errors', async () => {
    await service.handleError(new Error('boom'));
    expect(lastMessage()).toBe('errors.unexpected_error');
  });

  it('prefers the backend error code, then the backend message', async () => {
    await service.handleError(new HttpErrorResponse({ status: 409, error: { error: { code: 'CONFLICT' } } }));
    expect(lastMessage()).toBe('ERROR_CODES.CONFLICT');
    await service.handleError(new HttpErrorResponse({ status: 400, error: { message: '  Too short  ' } }));
    expect(lastMessage()).toBe('Too short');
  });

  it('falls back to status based keys', async () => {
    const cases: Array<[number, string]> = [
      [400, 'errors.bad_request'],
      [401, 'errors.unauthorized'],
      [403, 'errors.forbidden'],
      [404, 'errors.not_found'],
      [429, 'errors.too_many_requests'],
      [500, 'errors.server_error'],
      [418, 'errors.unknown_error'],
    ];
    for (const [status, key] of cases) {
      await service.handleError(new HttpErrorResponse({ status }));
      expect(lastMessage()).withContext(String(status)).toBe(key);
    }
  });

  it('shows warnings with an optional header', async () => {
    await service.showWarning('a');
    expect(toast.presentWarningToast).toHaveBeenCalledWith('top', 't:a');
    await service.showWarning('a', 'h');
    expect(toast.presentWarningToast).toHaveBeenCalledWith('top', 't:h: t:a');
  });
});
