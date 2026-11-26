import { OfflineStorageService } from './offline-storage.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';

class OperationsTable {
  constructor(public rows: any[]) {}
  where(index: string) {
    return {
      equals: (value: string) => ({
        filter: (predicate: (row: any) => boolean) => ({
          first: async () =>
            this.rows.find((row) => row[index] === value && predicate(row)),
          toArray: async () =>
            this.rows.filter((row) => row[index] === value && predicate(row)),
        }),
      }),
    };
  }
  update(id: string, changes: any) {
    const row = this.rows.find((item) => item.id === id);
    if (row) Object.assign(row, changes);
    return Promise.resolve();
  }
}

const op = (id: string, entityType: string, extra: any = {}) => ({
  id,
  ownerUserId: 'owner-a',
  entityType,
  entityId: id,
  retryCount: 0,
  maxRetries: 3,
  status: SyncStatus.PENDING,
  ...extra,
});

function harness(rows: any[]) {
  const operations = new OperationsTable(rows);
  const service = Object.create(OfflineStorageService.prototype) as any;
  service.tokenService = { getUserId: () => 'owner-a' };
  service.db = { syncOperations: operations };
  service.loadSyncQueue = async () => undefined;
  return { service, operations };
}

describe('plan-limit rejections in the sync queue', () => {
  it('marks a limit rejection terminal at once with a readable code', async () => {
    const h = harness([op('cat-1', 'category')]);
    await h.service.recordSyncFailure('cat-1', 'PLAN_LIMIT_EXCEEDED');
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({
        status: SyncStatus.ERROR,
        error: 'PLAN_LIMIT_EXCEEDED',
      })
    );
  });

  it('fails only pending expenses that point at a refused category', async () => {
    const h = harness([
      op('exp-1', 'expense', { data: { category: 'offline_cat_a' } }),
      op('exp-2', 'expense', { data: { category: { _id: 'offline_cat_a' } } }),
      op('exp-3', 'expense', { data: { category: 'offline_cat_b' } }),
      op('exp-4', 'expense', {
        data: { category: 'offline_cat_a' },
        status: SyncStatus.ERROR,
        error: 'SYNC_OPERATION_FAILED',
      }),
    ]);

    const changed = await h.service.failExpensesOfLimitedCategories([
      'offline_cat_a',
    ]);

    expect(changed).toBe(2);
    const byId = (id: string) => h.operations.rows.find((r) => r.id === id);
    expect(byId('exp-1').error).toBe('PLAN_LIMIT_EXCEEDED');
    expect(byId('exp-1').status).toBe(SyncStatus.ERROR);
    expect(byId('exp-2').error).toBe('PLAN_LIMIT_EXCEEDED');
    expect(byId('exp-3').status).toBe(SyncStatus.PENDING);
    expect(byId('exp-4').error).toBe('SYNC_OPERATION_FAILED');
  });

  it('does nothing without refused categories', async () => {
    const h = harness([
      op('exp-1', 'expense', { data: { category: 'offline_cat_a' } }),
    ]);
    expect(await h.service.failExpensesOfLimitedCategories([])).toBe(0);
    expect(h.operations.rows[0].status).toBe(SyncStatus.PENDING);
  });
});
