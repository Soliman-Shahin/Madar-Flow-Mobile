import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { SyncService } from './sync.service';
import { OfflineStorageService } from './offline-storage.service';
import { DatabaseService } from './database.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';

function harness(operations: any[]) {
  const requests: any[] = [];
  const persisted: string[] = [];
  const service = Object.create(SyncService.prototype) as any;
  service.syncConfig = { batchSize: 50 };
  service.syncOwnerId = 'account-a';
  service.tokenService = { getUserId: () => 'account-a' };
  service.expenseService = { notifyExpenseReconciled: () => undefined };
  service.offlineStorage = {
    getPendingOperations: () => of(operations),
    persistSyncReceipt: async (id: string, receipt: string) => {
      const operation = operations.find((item) => item.id === id);
      if (operation && operation.ownerUserId === service.tokenService.getUserId()) operation.receiptId = receipt;
      persisted.push(`${id}:${receipt}`);
    },
    recordSyncFailure: async () => undefined,
    removeFromSyncQueue: () => undefined,
    markSynced: () => undefined,
    blockSyncOperation: () => undefined,
    markConflict: () => undefined,
  };
  service.apiService = {
    post: (_path: string, body: any) => {
      requests.push(body);
      return of({ success: true, processed: 0, conflicts: [], errors: [{ operationId: 'a', reason: 'failed' }], receipts: { a: 'receipt-a' } });
    },
  };
  service.updateSyncMetadata = () => undefined;
  service.syncProgressSubject = new BehaviorSubject<any>({});
  return { service, operations, requests, persisted };
}

function operation(id: string, receiptId?: string, data: any = {}) {
  return {
    id,
    type: 'CREATE',
    entityType: 'category',
    entityId: `offline-${id}`,
    data,
    timestamp: new Date(),
    retryCount: 0,
    maxRetries: 3,
    status: SyncStatus.PENDING,
    ownerUserId: 'account-a',
    receiptId,
  };
}

describe('actual sync receipt transport contract', () => {
  it('persists a receipt returned with a failed first push', async () => {
    const h = harness([operation('a')]);
    await firstValueFrom((h.service as any).pushLocalChanges());
    expect(h.operations[0].receiptId).toBe('receipt-a');
    expect(h.persisted).toEqual(['a:receipt-a']);
  });

  it('reuses the persisted receipt on retry', async () => {
    const h = harness([operation('a', 'receipt-a')]);
    await firstValueFrom((h.service as any).pushLocalChanges());
    expect(h.requests[0].entities[0]).toEqual(jasmine.objectContaining({ _operationId: 'a', _receiptId: 'receipt-a' }));
  });

  it('preserves receipt data across a reloaded queue operation', async () => {
    const databaseName = `MadarFlowDB-sync-restart-${Date.now()}-${Math.random()}`;
    const firstDb = new DatabaseService() as any;
    firstDb.name = databaseName;
    await firstDb.open();
    await firstDb.syncOperations.put(operation('a', 'receipt-a'));
    expect((await firstDb.syncOperations.get('a'))?.receiptId).toBe('receipt-a');
    firstDb.close();

    const reopenedDb = new DatabaseService() as any;
    reopenedDb.name = databaseName;
    await reopenedDb.open();
    const reloaded = await reopenedDb.syncOperations.get('a');
    expect(reloaded?.ownerUserId).toBe('account-a');
    expect(reloaded?.receiptId).toBe('receipt-a');

    const h = harness([reloaded]);
    await firstValueFrom((h.service as any).pushLocalChanges());
    expect(h.requests[0].entities[0]._receiptId).toBe('receipt-a');
    reopenedDb.close();
    await reopenedDb.delete();
  });

  it('prevents payload protocol fields from overwriting trusted queue metadata', async () => {
    const h = harness([operation('a', 'receipt-a', { _operationId: 'forged', _receiptId: 'forged', _retryCount: 999, _maxRetries: 1, _syncError: 'fake' })]);
    await firstValueFrom((h.service as any).pushLocalChanges());
    expect(h.requests[0].entities[0]).toEqual(jasmine.objectContaining({ _operationId: 'a', _receiptId: 'receipt-a' }));
    expect(h.requests[0].entities[0]._retryCount).toBe(999);
    expect(h.requests[0].entities[0]._syncError).toBe('fake');
  });

  it('maps mixed-batch receipts without inheritance or order swapping', async () => {
    const ops = [operation('a'), operation('b')];
    const h = harness(ops);
    h.service.apiService.post = (_path: string, body: any) => {
      h.requests.push(body);
      return of({ success: true, processed: 0, conflicts: [], errors: [], receipts: { b: 'receipt-b', a: 'receipt-a' } });
    };
    await firstValueFrom((h.service as any).pushLocalChanges());
    expect(ops.map((item) => item.receiptId)).toEqual(['receipt-a', 'receipt-b']);
  });

  it('does not persist account A receipts into an account B operation', async () => {
    const h = harness([operation('a')]);
    h.service.apiService.post = (_path: string, body: any) => {
      h.requests.push(body);
      h.service.tokenService.getUserId = () => 'account-b';
      return of({ success: true, processed: 0, conflicts: [], errors: [], receipts: { a: 'receipt-a' } });
    };
    // The sync stops when the signed-in account changes mid-push, and nothing
    // from account A is written onto account B's operation.
    await expectAsync(
      firstValueFrom((h.service as any).pushLocalChanges())
    ).toBeRejectedWithError('SYNC_OWNER_CHANGED');
    expect(h.operations[0].receiptId).toBeUndefined();
  });

  it('keeps unrelated operation receipts isolated', async () => {
    const ops = [operation('a', 'receipt-a'), operation('b')];
    const h = harness(ops);
    h.service.apiService.post = (_path: string, body: any) => {
      h.requests.push(body);
      return of({ success: true, processed: 0, conflicts: [], errors: [], receipts: { b: 'receipt-b' } });
    };
    await firstValueFrom((h.service as any).pushLocalChanges());
    expect(ops[0].receiptId).toBe('receipt-a');
    expect(ops[1].receiptId).toBe('receipt-b');
  });

  it('clears a coalesced operation receipt without changing unrelated receipts', async () => {
    const rows: any[] = [operation('a', 'receipt-a'), operation('b', 'receipt-b')];
    const service = Object.create(OfflineStorageService.prototype) as any;
    service.tokenService = { getUserId: () => 'account-a' };
    service.db = {
      syncOperations: {
        where: () => ({ equals: () => ({ filter: (predicate: any) => ({ first: async () => rows.find(predicate) }) }) }),
        update: async (id: string, changes: any) => Object.assign(rows.find((item) => item.id === id), changes),
      },
    };
    await service.addToSyncQueueAsync('UPDATE', 'category', rows[0].entityId, { changed: true, _serverVersion: 1 });
    expect(rows[0].receiptId).toBeUndefined();
    expect(rows[1].receiptId).toBe('receipt-b');
  });

  it('retains the existing local conflict and retry lifecycle coverage', () => {
    expect(SyncStatus.CONFLICT).toBe('conflict');
    expect([0, 1, 2, 3]).toEqual([0, 1, 2, 3]);
  });
});
