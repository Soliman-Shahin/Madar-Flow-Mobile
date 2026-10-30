import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { NotificationPreferenceService } from './notification-preference.service';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../models/notification-preference.model';

describe('NotificationPreferenceService', () => {
  function createService(api: any, getUserId = () => 'user-a') {
    return new NotificationPreferenceService(api, { getUserId } as any);
  }

  it('uses safe all-enabled defaults before a server response', () => {
    const service = createService({});
    expect(service.current).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('loads and updates the current owner preferences', fakeAsync(() => {
    const categories = {
      sync: { inbox: true, realtime: true, push: false },
      subscription: { inbox: true, realtime: true, push: true },
      security: { inbox: true, realtime: true, push: true },
      general: { inbox: true, realtime: true, push: true },
    } as const;
    const api = {
      get: jasmine.createSpy().and.returnValue(of({ categories })),
      patch: jasmine.createSpy().and.returnValue(of({ categories })),
    };
    const service = createService(api);

    service.load().subscribe();
    expect(service.current).toEqual(categories);
    service.update({ sync: { push: false } }).subscribe();
    flushMicrotasks();
    expect(api.patch).toHaveBeenCalledWith('/notifications/preferences', {
      sync: { push: false },
    });
    service.clearForOwner();
    expect(service.current.sync.push).toBe(true);
  }));

  it('keeps server state unchanged when the preference API fails', () => {
    const api = {
      get: jasmine
        .createSpy()
        .and.returnValue(throwError(() => new Error('request failed'))),
    };
    const service = createService(api);
    service.load().subscribe({ error: () => undefined });
    expect(service.current).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('clears owner A before owner B is active', () => {
    const service = createService({});
    service.clearForOwner();
    expect(service.current).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('does not apply a stale owner A response after switching to owner B', () => {
    let owner = 'user-a';
    const response$ = new Subject<any>();
    const api = { get: jasmine.createSpy().and.returnValue(response$) };
    const service = createService(api, () => owner);

    service.load().subscribe();
    owner = 'user-b';
    response$.next({
      categories: {
        sync: { inbox: false, realtime: false, push: false },
        subscription: { inbox: true, realtime: true, push: true },
        security: { inbox: true, realtime: true, push: true },
        general: { inbox: true, realtime: true, push: true },
      },
    });

    expect(service.current).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('serializes rapid updates to the same field and keeps narrow patches', fakeAsync(() => {
    const firstResponse$ = new Subject<any>();
    const secondResponse$ = new Subject<any>();
    let call = 0;
    const api = {
      patch: jasmine.createSpy().and.callFake(() => {
        call += 1;
        return call === 1 ? firstResponse$ : secondResponse$;
      }),
    };
    const service = createService(api);
    const categories = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      sync: { inbox: true, realtime: true, push: false },
    };
    const finalCategories = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      sync: { inbox: true, realtime: true, push: true },
    };

    service.update({ sync: { push: false } }).subscribe();
    service.update({ sync: { push: true } }).subscribe();
    flushMicrotasks();

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.calls.argsFor(0)[1]).toEqual({ sync: { push: false } });

    firstResponse$.next({ categories });
    firstResponse$.complete();
    flushMicrotasks();
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(api.patch.calls.argsFor(1)[1]).toEqual({ sync: { push: true } });

    secondResponse$.next({ categories: finalCategories });
    secondResponse$.complete();
    flushMicrotasks();
    expect(service.current).toEqual(finalCategories);
  }));

  it('keeps the current state when a preference update fails', () => {
    const initial = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      sync: { inbox: true, realtime: true, push: true },
    };
    const api = {
      patch: jasmine
        .createSpy()
        .and.returnValue(throwError(() => new Error('request failed'))),
    };
    const service = createService(api);
    service.load = jasmine.createSpy().and.returnValue(of(initial));
    (service as any).state.next(initial);

    service
      .update({ sync: { push: false } })
      .subscribe({ error: () => undefined });

    expect(service.current).toEqual(initial);
  });
});
