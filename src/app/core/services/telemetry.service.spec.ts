import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { TelemetryService } from './telemetry.service';
import { TokenService } from 'src/app/modules/auth/services/token.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('TelemetryService', () => {
  let service: TelemetryService;
  let api: { post: jasmine.Spy; delete: jasmine.Spy };
  let userId: string | null;

  const stored = (key: string) => localStorage.getItem('madarflow_' + key);

  beforeEach(() => {
    localStorage.clear();
    userId = 'user-1';
    api = {
      post: jasmine.createSpy('post').and.returnValue(of({})),
      delete: jasmine.createSpy('delete').and.returnValue(of({})),
    };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: TokenService, useValue: { getUserId: () => userId } },
      ],
    });
    service = TestBed.inject(TelemetryService);
  });

  afterEach(() => localStorage.clear());

  it('does nothing until the user opts in', async () => {
    expect(service.needsPrompt).toBeTrue();
    service.track('app_open');
    service.trackAppOpen();
    await service.flush();
    expect(stored('telemetry_queue')).toBeNull();
    expect(stored('telemetry_install_id')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('declining keeps it off and never asks again', async () => {
    await service.setConsent(false);
    expect(service.consent).toBe('declined');
    expect(service.needsPrompt).toBeFalse();
    service.track('transaction_added');
    expect(stored('telemetry_queue')).toBeNull();
    expect(api.delete).not.toHaveBeenCalled(); // nothing was ever sent
  });

  it('opting in creates a random install id and queues events', async () => {
    await service.setConsent(true);
    const id = JSON.parse(stored('telemetry_install_id')!);
    expect(id).toMatch(UUID);
    service.track('transaction_added');
    expect(JSON.parse(stored('telemetry_queue')!).length).toBe(1);
  });

  it('sends only the allowed fields, in batches, and clears what was sent', async () => {
    await service.setConsent(true);
    for (let i = 0; i < 30; i++) service.track('app_open');
    // The 10th event triggers a flush on its own; wait for everything queued.
    await service.flush();

    expect(api.post.calls.count()).toBeGreaterThan(0);
    const bodies = api.post.calls.allArgs().map((a) => a[1]);
    for (const body of bodies) {
      expect(Object.keys(body).sort()).toEqual(
        ['appVersion', 'events', 'installId', 'lang', 'platform']
      );
      expect(body.events.length).toBeLessThanOrEqual(25);
      for (const e of body.events) expect(Object.keys(e).sort()).toEqual(['name', 'ts']);
      expect(body.platform).toBe('web');
    }
    expect(api.post.calls.first().args[0]).toBe('/telemetry/events');
    expect(JSON.parse(stored('telemetry_queue')!)).toEqual([]);
  });

  it('keeps events when sending fails and caps the queue', async () => {
    api.post.and.returnValue(throwError(() => new Error('offline')));
    await service.setConsent(true);
    for (let i = 0; i < 120; i++) service.track('sync_completed');
    await service.flush();
    expect(JSON.parse(stored('telemetry_queue')!).length).toBe(100);
  });

  it('does not send without a signed-in session', async () => {
    await service.setConsent(true);
    userId = null;
    service.track('app_open');
    await service.flush();
    expect(api.post).not.toHaveBeenCalled();
    expect(JSON.parse(stored('telemetry_queue')!).length).toBe(1);
  });

  it('throttles "app opened" to once per half hour', async () => {
    await service.setConsent(true);
    const t = 1_700_000_000_000;
    service.trackAppOpen(t);
    service.trackAppOpen(t + 5 * 60_000);
    service.trackAppOpen(t + 29 * 60_000);
    expect(JSON.parse(stored('telemetry_queue')!).length).toBe(1);
    service.trackAppOpen(t + 31 * 60_000);
    expect(JSON.parse(stored('telemetry_queue')!).length).toBe(2);
  });

  it('opting out erases local data and asks the server to delete the install', async () => {
    await service.setConsent(true);
    const id = JSON.parse(stored('telemetry_install_id')!);
    service.track('app_open');

    await service.setConsent(false);

    expect(stored('telemetry_queue')).toBeNull();
    expect(stored('telemetry_install_id')).toBeNull();
    expect(api.delete).toHaveBeenCalledWith('/telemetry/events', {
      body: { installId: id },
    });
    expect(stored('telemetry_pending_erase')).toBeNull();
  });

  it('retries the server-side erase later when opting out while offline', async () => {
    api.delete.and.returnValue(throwError(() => new Error('offline')));
    await service.setConsent(true);
    const id = JSON.parse(stored('telemetry_install_id')!);
    await service.setConsent(false);
    expect(JSON.parse(stored('telemetry_pending_erase')!)).toBe(id);

    api.delete.and.returnValue(of({}));
    await service.flush();
    expect(api.delete).toHaveBeenCalledTimes(2);
    expect(stored('telemetry_pending_erase')).toBeNull();
  });

  it('uses a fresh install id when the user opts in again', async () => {
    await service.setConsent(true);
    const first = JSON.parse(stored('telemetry_install_id')!);
    await service.setConsent(false);
    await service.setConsent(true);
    const second = JSON.parse(stored('telemetry_install_id')!);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });
});
