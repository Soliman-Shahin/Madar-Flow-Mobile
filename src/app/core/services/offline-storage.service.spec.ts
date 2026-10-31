import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { DatabaseService } from './database.service';
import { OfflineStorageService } from './offline-storage.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';

/**
 * Runs the real service against a real IndexedDB (unique database per test), with only the
 * signed-in user faked. Covers the offline queue the app depends on to never lose or leak data.
 */
async function harness(initialOwner: string | null = 'account-a') {
  const state = { owner: initialOwner };
  const db = new DatabaseService() as any;
  db.name = `MadarFlowDB-offline-spec-${Date.now()}-${Math.random()}`;
  await db.open();
  const service = Object.create(OfflineStorageService.prototype) as any;
  service.db = db;
  service.tokenService = { getUserId: () => state.owner, user: () => null, getUser: () => null };
  service.syncQueueSubject = new BehaviorSubject({
    operations: [],
    isProcessing: false,
    lastProcessed: new Date(),
    totalProcessed: 0,
    totalErrors: 0,
  });
  service.syncQueue$ = service.syncQueueSubject.asObservable();
  return {
    service,
    db,
    state,
    close: async () => {
      db.close();
      await db.delete();
    },
  };
}

const expense = (id: string, extra: Record<string, unknown> = {}) =>
  ({ _id: id, description: id, amount: 5, ...extra }) as any;

describe('OfflineStorageService (real IndexedDB)', () => {
  it('stores a new entity as pending, owned by the signed-in user, and queues one CREATE', async () => {
    const h = await harness();
    const saved = (await firstValueFrom(h.service.saveEntity('expenses', expense('offline_1'), 'CREATE'))) as any;
    expect(saved.ownerUserId).toBe('account-a');
    expect(saved._syncStatus).toBe(SyncStatus.PENDING);
    expect(saved._version).toBe(1);
    expect(saved._clientId).toBe('offline_1');

    const ops = await h.db.syncOperations.toArray();
    expect(ops.length).toBe(1);
    expect(ops[0]).toEqual(
      jasmine.objectContaining({ type: 'CREATE', entityId: 'offline_1', status: SyncStatus.PENDING, ownerUserId: 'account-a' })
    );
    await h.close();
  });

  it('coalesces repeated edits of the same pending entity into one UPDATE and bumps the version', async () => {
    const h = await harness();
    await firstValueFrom(h.service.saveEntity('expenses', expense('e1'), 'UPDATE'));
    const second = (await firstValueFrom(h.service.saveEntity('expenses', expense('e1', { amount: 9 }), 'UPDATE'))) as any;
    expect(second._version).toBe(2);
    expect(second.amount).toBe(9);
    const ops = await h.db.syncOperations.toArray();
    expect(ops.length).toBe(1);
    expect(ops[0].data.amount).toBe(9);
    await h.close();
  });

  it('keeps accounts apart: another user cannot read or overwrite an entity', async () => {
    const h = await harness('account-a');
    await firstValueFrom(h.service.saveEntity('expenses', expense('shared-id'), 'CREATE'));

    h.state.owner = 'account-b';
    expect(await firstValueFrom(h.service.getEntity('expenses', 'shared-id'))).toBeNull();
    expect(await firstValueFrom(h.service.getEntities('expenses'))).toEqual([]);
    await expectAsync(
      firstValueFrom(h.service.saveEntity('expenses', expense('shared-id', { amount: 1 }), 'UPDATE'))
    ).toBeRejectedWithError(/another user/);
    expect(await firstValueFrom(h.service.deleteEntity('expenses', 'shared-id'))).toBeFalse();

    h.state.owner = 'account-a';
    expect(((await firstValueFrom(h.service.getEntity('expenses', 'shared-id'))) as any).amount).toBe(5);
    await h.close();
  });

  it('refuses to work without a signed-in user', async () => {
    const h = await harness(null);
    await expectAsync(firstValueFrom(h.service.saveEntity('expenses', expense('x'), 'CREATE'))).toBeRejectedWithError(
      /Authenticated user/
    );
    expect(await firstValueFrom(h.service.getEntities('expenses'))).toEqual([]);
    expect(await firstValueFrom(h.service.getPendingOperations())).toEqual([]);
    await h.close();
  });

  it('deleting is a soft delete that queues a DELETE operation', async () => {
    const h = await harness();
    await firstValueFrom(h.service.saveEntity('expenses', expense('d1'), 'CREATE'));
    expect(await firstValueFrom(h.service.deleteEntity('expenses', 'd1'))).toBeTrue();
    const row = await h.db.expenses.get('d1');
    expect(row._isDeleted).toBeTrue();
    expect(row._syncStatus).toBe(SyncStatus.PENDING);
    const types = (await h.db.syncOperations.toArray()).map((o: any) => o.type).sort();
    expect(types).toEqual(['CREATE', 'DELETE']);
    await h.close();
  });

  it('getPendingOperations returns only the signed-in user pending operations', async () => {
    const h = await harness('account-a');
    await firstValueFrom(h.service.saveEntity('expenses', expense('a1'), 'CREATE'));
    h.state.owner = 'account-b';
    await firstValueFrom(h.service.saveEntity('expenses', expense('b1'), 'CREATE'));
    await h.service.loadSyncQueue();
    const pendingB = await firstValueFrom(h.service.getPendingOperations());
    expect((pendingB as any[]).map((o) => o.entityId)).toEqual(['b1']);
    h.state.owner = 'account-a';
    await h.service.loadSyncQueue();
    const pendingA = await firstValueFrom(h.service.getPendingOperations());
    expect((pendingA as any[]).map((o) => o.entityId)).toEqual(['a1']);
    await h.close();
  });

  it('records failures, turns an operation into an error after its retries, and exposes unsynced work', async () => {
    const h = await harness();
    await firstValueFrom(h.service.saveEntity('expenses', expense('f1'), 'CREATE'));
    const [op] = await h.db.syncOperations.toArray();
    await h.db.syncOperations.update(op.id, { maxRetries: 2 });

    const first = await h.service.recordSyncFailure(op.id, 'raw server text must not be stored');
    expect(first!.status).toBe(SyncStatus.PENDING);
    expect(first!.retryCount).toBe(1);
    const second = await h.service.recordSyncFailure(op.id);
    expect(second!.status).toBe(SyncStatus.ERROR);
    expect((await h.db.syncOperations.get(op.id)).error).toBe('SYNC_OPERATION_FAILED');
    expect(await h.service.hasUnsyncedChanges()).toBeTrue();
    expect(await h.service.recordSyncFailure('missing')).toBeNull();
    await h.close();
  });

  it('persists a receipt on the owner operation only', async () => {
    const h = await harness('account-a');
    await firstValueFrom(h.service.saveEntity('expenses', expense('r1'), 'CREATE'));
    const [op] = await h.db.syncOperations.toArray();
    h.state.owner = 'account-b';
    await h.service.persistSyncReceipt(op.id, 'stolen');
    expect((await h.db.syncOperations.get(op.id)).receiptId).toBeUndefined();
    h.state.owner = 'account-a';
    await h.service.persistSyncReceipt(op.id, 'receipt-1');
    expect((await h.db.syncOperations.get(op.id)).receiptId).toBe('receipt-1');
    await h.close();
  });

  it('removeFromSyncQueue drops a pending operation of the signed-in user', async () => {
    const h = await harness();
    await firstValueFrom(h.service.saveEntity('expenses', expense('q1'), 'CREATE'));
    const [op] = await h.db.syncOperations.toArray();
    h.service.removeFromSyncQueue(op.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await h.db.syncOperations.count()).toBe(0);
    await h.close();
  });

  it('replaceEntities stamps rows with the signed-in owner', async () => {
    const h = await harness();
    expect(await firstValueFrom(h.service.replaceEntities('expenses', [expense('s1'), expense('s2')]))).toBeTrue();
    const rows = await h.db.expenses.toArray();
    expect(rows.map((r: any) => r.ownerUserId)).toEqual(['account-a', 'account-a']);
    await h.close();
  });
});
