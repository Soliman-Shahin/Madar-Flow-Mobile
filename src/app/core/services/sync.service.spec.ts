import { firstValueFrom, of } from 'rxjs';
import { SyncService } from './sync.service';

/** Gating and merge boundaries of the sync engine (the push path has its own contract specs). */
function harness(overrides: Record<string, unknown> = {}) {
  const merged: Array<{ type: string; count: number }> = [];
  const service = Object.create(SyncService.prototype) as any;
  service.syncInProgress = false;
  service.isOnline = true;
  service.tokenService = { getUserId: () => 'account-a' };
  service.offlineStorage = {
    mergeEntities: (type: string, entities: any[]) => {
      merged.push({ type, count: entities.length });
      return of(true);
    },
  };
  service.updateSyncMetadata = () => undefined;
  service.updateSyncProgress = () => undefined;
  Object.assign(service, overrides);
  return { service, merged };
}

describe('SyncService gating', () => {
  it('does nothing while another sync is running', async () => {
    const { service } = harness({ syncInProgress: true });
    expect(await firstValueFrom(service.syncAll())).toBeFalse();
  });

  it('does nothing while the device is offline', async () => {
    const { service } = harness({ isOnline: false });
    expect(await firstValueFrom(service.syncAll())).toBeFalse();
    expect(service.syncInProgress).toBeFalse();
  });

  it('refuses to start without a signed-in user and releases the lock', async () => {
    const { service } = harness({ tokenService: { getUserId: () => null } });
    expect(await firstValueFrom(service.syncAll())).toBeFalse();
    expect(service.syncInProgress).toBeFalse();
  });
});

describe('SyncService merge of pulled data', () => {
  it('has nothing to do for an empty pull', async () => {
    const { service, merged } = harness();
    expect(await firstValueFrom(service.mergeWithLocalData([]))).toBeTrue();
    expect(await firstValueFrom(service.mergeWithLocalData(undefined as any))).toBeTrue();
    expect(merged).toEqual([]);
  });

  it('routes expenses (including legacy "outcome") and categories to their own tables', async () => {
    const { service, merged } = harness();
    const entities = [
      { _entityType: 'expense', _id: '1' },
      { _entityType: 'outcome', _id: '2' },
      { _entityType: 'category', _id: '3' },
      { _entityType: 'user', _id: '4' },
    ];
    expect(await firstValueFrom(service.mergeWithLocalData(entities))).toBeTrue();
    expect(merged).toEqual([
      { type: 'expense', count: 2 },
      { type: 'category', count: 1 },
    ]);
  });

  it('ignores entity types it does not store', async () => {
    const { service, merged } = harness();
    expect(await firstValueFrom(service.mergeWithLocalData([{ _entityType: 'user', _id: '9' }]))).toBeTrue();
    expect(merged).toEqual([]);
  });
});
