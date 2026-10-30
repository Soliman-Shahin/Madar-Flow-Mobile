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

// `ownerUserId` owns the stored operation; `activeOwner` is who is signed in.
function harness(ownerUserId = 'owner-a', activeOwner = ownerUserId) {
  const operations = new OperationsTable([
    {
      id: 'operation-1',
      ownerUserId,
      retryCount: 0,
      maxRetries: 3,
      status: SyncStatus.PENDING,
    },
  ]);
  const service = Object.create(OfflineStorageService.prototype) as any;
  service.tokenService = { getUserId: () => activeOwner };
  service.db = { syncOperations: operations };
  service.loadSyncQueue = async () => undefined;
  return { service, operations };
}

describe('durable repeated sync failure lifecycle', () => {
  it('starts at zero and transitions pending at one and two, then terminal at three', async () => {
    const h = harness();
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({ retryCount: 0, status: SyncStatus.PENDING })
    );

    await h.service.recordSyncFailure('operation-1');
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({ retryCount: 1, status: SyncStatus.PENDING })
    );
    await h.service.recordSyncFailure('operation-1');
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({ retryCount: 2, status: SyncStatus.PENDING })
    );
    await h.service.recordSyncFailure('operation-1');
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({
        retryCount: 3,
        maxRetries: 3,
        status: SyncStatus.ERROR,
        error: 'SYNC_OPERATION_FAILED',
      })
    );
  });

  it('persists the durable state and never crosses an owner boundary', async () => {
    const h = harness('owner-a');
    const result = await h.service.recordSyncFailure('operation-1');
    expect(result).toEqual(
      jasmine.objectContaining({ ownerUserId: 'owner-a', retryCount: 1 })
    );

    // owner-b is signed in; the operation belongs to owner-a.
    const other = harness('owner-a', 'owner-b');
    expect(await other.service.recordSyncFailure('operation-1')).toBeNull();
    expect(other.operations.rows[0].retryCount).toBe(0);
  });

  it('does not increment when there is no operation to attempt', async () => {
    const h = harness();
    expect(await h.service.recordSyncFailure('missing-operation')).toBeNull();
    expect(h.operations.rows[0].retryCount).toBe(0);
  });

  it('captures the owner before an account switch can affect persistence', async () => {
    const h = harness('owner-a');
    h.operations.rows.push({
      id: 'operation-1',
      ownerUserId: 'owner-b',
      retryCount: 0,
      maxRetries: 3,
      status: SyncStatus.PENDING,
    });
    let activeOwner = 'owner-a';
    h.service.tokenService.getUserId = () => activeOwner;

    const update = h.service.recordSyncFailure('operation-1');
    activeOwner = 'owner-b';
    await update;

    expect(h.operations.rows[0].retryCount).toBe(1);
    expect(h.operations.rows[1].retryCount).toBe(0);
  });

  it('keeps conflict handling outside the failure counter', async () => {
    const h = harness();
    h.operations.rows[0].status = SyncStatus.CONFLICT;
    h.operations.rows[0].conflictId = 'conflict-1';
    expect(await h.service.recordSyncFailure('operation-1')).toEqual(
      jasmine.objectContaining({ retryCount: 0, status: SyncStatus.CONFLICT })
    );
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({
        retryCount: 0,
        status: SyncStatus.CONFLICT,
        conflictId: 'conflict-1',
      })
    );
  });
});
