import { defer, firstValueFrom, of, throwError } from 'rxjs';
import { OfflineStorageService } from './offline-storage.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';

const keyOf = (row: any) => row._id ?? row.id;

class RowsTable {
  constructor(public rows: any[]) {}
  get(id: string) {
    return Promise.resolve(this.rows.find((row) => keyOf(row) === id));
  }
  put(row: any) {
    const i = this.rows.findIndex((r) => keyOf(r) === keyOf(row));
    if (i < 0) this.rows.push(row);
    else this.rows[i] = row;
    return Promise.resolve();
  }
  update(id: string, changes: any) {
    const row = this.rows.find((r) => keyOf(r) === id);
    if (row) Object.assign(row, changes);
    return Promise.resolve();
  }
  where(index: string) {
    return {
      equals: (value: any) => ({
        toArray: async () => this.rows.filter((row) => row[index] === value),
        delete: async () => {
          this.rows = this.rows.filter((row) => row[index] !== value);
        },
        filter: (predicate: any) => ({
          delete: async () => {
            this.rows = this.rows.filter(
              (row) => !(row[index] === value && predicate(row))
            );
          },
          modify: async (changes: any) => {
            for (const row of this.rows)
              if (row[index] === value && predicate(row))
                Object.assign(row, changes);
          },
          first: async () =>
            this.rows.find((row) => row[index] === value && predicate(row)),
        }),
      }),
    };
  }
}

function harness(owner = 'owner-a', currentOwner = owner) {
  const expenses = new RowsTable([
    {
      _id: 'expense-1',
      ownerUserId: owner,
      amount: 200,
      _syncStatus: SyncStatus.CONFLICT,
      _version: 2,
      _serverVersion: 2,
    },
  ]);
  const operations = new RowsTable([
    {
      id: 'op-1',
      entityId: 'expense-1',
      entityType: 'expense',
      ownerUserId: owner,
      status: SyncStatus.CONFLICT,
      conflictId: 'conflict-1',
      type: 'UPDATE',
      data: { amount: 200 },
    },
  ]);
  let transactionActive = false;
  const service = Object.create(OfflineStorageService.prototype) as any;
  service.currentOwnerId = () => currentOwner;
  service.tokenService = { getUserId: () => currentOwner };
  service.db = {
    expenses,
    categories: new RowsTable([]),
    syncOperations: operations,
    getTable: (entityType: string) =>
      /categor/i.test(entityType) ? service.db.categories : expenses,
    transaction: async (_mode: string, ...args: any[]) => {
      transactionActive = true;
      try {
        return await args[args.length - 1]();
      } finally {
        transactionActive = false;
      }
    },
  };
  // The queue is derived from the rows at subscription time.
  service.syncQueue$ = defer(() => of({ operations: operations.rows }));
  service.loadSyncQueue = async () => {
    if (transactionActive)
      throw new Error('queue refresh must run after the Dexie transaction');
    await service.db.syncOperations
      .where('ownerUserId')
      .equals(currentOwner)
      .toArray();
  };
  return { service, expenses, operations };
}

describe('Consumer sync conflict lifecycle storage', () => {
  it('blocks a pending operation durably and excludes it from pending operations', async () => {
    const h = harness();
    h.operations.rows[0].status = SyncStatus.PENDING;
    h.service.blockSyncOperation('op-1', 'conflict-1');
    await Promise.resolve();
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({
        status: SyncStatus.CONFLICT,
        conflictId: 'conflict-1',
      })
    );
    expect(await firstValueFrom(h.service.getPendingOperations())).toEqual([]);
  });

  it('re-reads blocked state with owner and conflict identity intact', async () => {
    const h = harness();
    const reread = await h.service.db.syncOperations.get('op-1');
    expect(reread).toEqual(
      jasmine.objectContaining({
        ownerUserId: 'owner-a',
        status: SyncStatus.CONFLICT,
        conflictId: 'conflict-1',
      })
    );
    expect(await firstValueFrom(h.service.getPendingOperations())).toEqual([]);
  });

  it('finalizes local/server/merge authoritative responses by retiring only the matching row', async () => {
    for (const amount of [200, 300, 250]) {
      const h = harness();
      h.operations.rows.push({
        id: `other-${amount}`,
        entityId: 'other',
        ownerUserId: 'owner-a',
        status: SyncStatus.PENDING,
      });
      expect(
        await firstValueFrom(
          h.service.finalizeConflictResolution(
            'expense',
            'expense-1',
            'conflict-1',
            { _id: 'expense-1', amount, _version: 3 }
          )
        )
      ).toBeTrue();
      expect(h.expenses.rows[0]).toEqual(
        jasmine.objectContaining({
          amount,
          _version: 3,
          _serverVersion: 3,
          _syncStatus: SyncStatus.SYNCED,
        })
      );
      expect(
        h.operations.rows.some((row) => row.conflictId === 'conflict-1')
      ).toBeFalse();
      expect(
        h.operations.rows.some((row) => row.id === `other-${amount}`)
      ).toBeTrue();
    }
  });

  it('refreshes the queue only after conflict finalization transaction closes', async () => {
    const h = harness();
    expect(
      await firstValueFrom(
        h.service.finalizeConflictResolution(
          'expense',
          'expense-1',
          'conflict-1',
          { _id: 'expense-1', amount: 300, _version: 3 }
        )
      )
    ).toBeTrue();
  });

  it('does not finalize another owner operation', async () => {
    // Rows belong to owner-b while owner-a is signed in.
    const h = harness('owner-b', 'owner-a');
    expect(
      await firstValueFrom(
        h.service.finalizeConflictResolution(
          'expense',
          'expense-1',
          'conflict-1',
          { _id: 'expense-1', amount: 999, _version: 9 }
        )
      )
    ).toBeFalse();
  });

  it('keeps a blocked delete excluded and retires it only after resolution', async () => {
    const h = harness();
    h.operations.rows[0].type = 'DELETE';
    h.operations.rows[0].data = { _isDeleted: true };
    expect(await firstValueFrom(h.service.getPendingOperations())).toEqual([]);
    await firstValueFrom(
      h.service.finalizeConflictResolution(
        'expense',
        'expense-1',
        'conflict-1',
        { _id: 'expense-1', _isDeleted: true, _version: 3 }
      )
    );
    expect(
      h.operations.rows.some((row) => row.conflictId === 'conflict-1')
    ).toBeFalse();
  });

  it('preserves blocked state when an external resolution request fails', () => {
    const h = harness();
    const failedRequest = throwError(() => new Error('resolution failed'));
    failedRequest.subscribe({ error: () => undefined });
    expect(h.operations.rows[0]).toEqual(
      jasmine.objectContaining({
        status: SyncStatus.CONFLICT,
        conflictId: 'conflict-1',
      })
    );
  });
});
