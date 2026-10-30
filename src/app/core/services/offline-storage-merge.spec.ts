import { firstValueFrom } from 'rxjs';
import { OfflineStorageService } from './offline-storage.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';

class TableDouble {
  constructor(public rows: any[]) {}
  where(index: string) {
    return {
      equals: (value: any) => ({
        toArray: async () => this.rows.filter((row) =>
          index === 'ownerUserId' ? row.ownerUserId === value : true
        ),
        delete: async () => {
          this.rows = this.rows.filter((row) => row.ownerUserId !== value);
        },
      }),
    };
  }
  async bulkPut(rows: any[]) {
    for (const row of rows) {
      const index = this.rows.findIndex((current) => current._id === row._id);
      if (index >= 0) this.rows[index] = row;
      else this.rows.push(row);
    }
  }
}

describe('OfflineStorageService restore merge boundary', () => {
  it('preserves current rows, restores missing rows, and queues offline creates', async () => {
    const owner = 'account-a';
    const expenses = new TableDouble([
      { _id: 'current', ownerUserId: owner, amount: 99 },
      { _id: 'other', ownerUserId: 'account-b', amount: 7 },
    ]);
    const categories = new TableDouble([]);
    const queued: any[] = [];
    const service = Object.create(OfflineStorageService.prototype) as any;
    service.currentOwnerId = () => owner;
    service.db = {
      expenses,
      categories,
      syncOperations: {},
      transaction: async (_mode: string, ...args: any[]) =>
        args[args.length - 1](),
    };
    service.addToSyncQueueAsync = async (...args: any[]) => queued.push(args);

    await firstValueFrom(
      service.replaceEntitiesAtomically(
        [
          { _id: 'current', ownerUserId: 'spoofed', amount: 1 },
          { _id: 'offline_new', amount: 2 },
        ],
        []
      )
    );

    expect(expenses.rows).toContain(jasmine.objectContaining({ _id: 'current', amount: 99 }));
    expect(expenses.rows).toContain(jasmine.objectContaining({ _id: 'offline_new', ownerUserId: owner, _syncStatus: SyncStatus.PENDING }));
    expect(expenses.rows).toContain(jasmine.objectContaining({ _id: 'other', ownerUserId: 'account-b' }));
    expect(queued.length).toBe(1);
    expect(queued[0][0]).toBe('CREATE');
  });

  it('does not resurrect a current tombstone with the same identity', async () => {
    const owner = 'account-a';
    const expenses = new TableDouble([{ _id: 'deleted', ownerUserId: owner, _isDeleted: true }]);
    const service = Object.create(OfflineStorageService.prototype) as any;
    service.currentOwnerId = () => owner;
    service.db = {
      expenses,
      categories: new TableDouble([]),
      syncOperations: {},
      transaction: async (_mode: string, ...args: any[]) => args[args.length - 1](),
    };
    service.addToSyncQueueAsync = async () => fail('tombstone must not queue a create');

    await firstValueFrom(service.replaceEntitiesAtomically([{ _id: 'deleted', amount: 4 }], []));
    expect(expenses.rows).toContain(jasmine.objectContaining({ _id: 'deleted', _isDeleted: true }));
  });
});
