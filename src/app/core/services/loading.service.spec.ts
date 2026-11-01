import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { LoadingService } from './loading.service';

describe('LoadingService', () => {
  let service: LoadingService;
  const on = () => (service as any).loadingSignal() as boolean;
  const message = () => (service as any).messageSignal() as string | null;
  beforeEach(() => (service = TestBed.inject(LoadingService)));

  it('requires an id', () => {
    expect(() => service.show('')).toThrowError();
    expect(() => service.hide('')).toThrowError();
  });

  it('does not flash for operations that finish before the delay', fakeAsync(() => {
    service.show('quick', 'Working', 100);
    expect(service.isLoading).toBeTrue();
    service.hide('quick');
    tick(200);
    expect(service.isLoading).toBeFalse();
    expect(on()).toBeFalse();
  }));

  it('turns the loader on after the delay and off after the matching hide', fakeAsync(() => {
    service.show('slow', 'Saving', 50);
    tick(60);
    expect(on()).toBeTrue();
    expect(message()).toBe('Saving');
    service.hide('slow');
    expect(on()).toBeFalse();
    expect(message()).toBeNull();
  }));

  it('keeps loading until every concurrent show is hidden', fakeAsync(() => {
    service.show('a', null, 0);
    service.show('a', null, 0);
    tick(1);
    service.hide('a');
    expect(service.isLoading).toBeTrue();
    service.hide('a');
    expect(service.isLoading).toBeFalse();
  }));

  it('clearAll resets state and cancels pending timers', fakeAsync(() => {
    service.show('x', 'msg', 500);
    service.clearAll();
    tick(600);
    expect(service.isLoading).toBeFalse();
    expect(on()).toBeFalse();
  }));
});
