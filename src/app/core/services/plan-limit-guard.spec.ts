import { Subject, firstValueFrom } from 'rxjs';
import { OfflineStorageService } from './offline-storage.service';
import {
  LocalPlanLimitError,
  PlanLimitGuardService,
  isPlanLimitError,
} from './plan-limit-guard.service';
import { PlanService } from './plan.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';

class Table {
  constructor(public rows: any[]) {}
  where(index: string) {
    return {
      equals: (value: string) => {
        const base = () => this.rows.filter((row) => row[index] === value);
        return {
          toArray: async () => base(),
          filter: (predicate: (row: any) => boolean) => ({
            toArray: async () => base().filter(predicate),
            first: async () => base().find(predicate),
          }),
        };
      },
    };
  }
  update(id: string, changes: any) {
    const row = this.rows.find((item) => item.id === id);
    if (row) Object.assign(row, changes);
    return Promise.resolve();
  }
  delete(id: string) {
    this.rows = this.rows.filter((row) => (row.id ?? row._id) !== id);
    return Promise.resolve();
  }
}

const thisMonth = () => new Date().toISOString();
const lastYear = () =>
  new Date(new Date().getFullYear() - 1, 0, 15).toISOString();

function storage(rows: { categories?: any[]; expenses?: any[]; ops?: any[] }) {
  const service = Object.create(OfflineStorageService.prototype) as any;
  const db = {
    categories: new Table(rows.categories ?? []),
    expenses: new Table(rows.expenses ?? []),
    syncOperations: new Table(rows.ops ?? []),
    tables: {} as any,
    getTable(type: string) {
      return type === 'category' ? this.categories : this.expenses;
    },
  };
  service.db = db;
  service.tokenService = { getUserId: () => 'u1' };
  service.loadSyncQueue = async () => undefined;
  return { service, db };
}

const mine = (extra: any) => ({ ownerUserId: 'u1', ...extra });

describe('local plan usage', () => {
  it('counts own categories and this month transactions like the server', async () => {
    const { service } = storage({
      categories: [
        mine({ _id: 'c1' }),
        mine({ _id: 'c2', isStarter: true }),
        mine({ _id: 'c3', isDefault: true }),
        mine({ _id: 'c4', _isDeleted: true }),
        { _id: 'c5', ownerUserId: 'other' },
      ],
      expenses: [
        mine({ _id: 'e1', date: thisMonth() }),
        mine({ _id: 'e2', date: lastYear() }),
        mine({ _id: 'e3', date: thisMonth(), _isDeleted: true }),
      ],
    });
    expect(await service.countPlanUsage()).toEqual({
      categories: 1,
      transactionsThisMonth: 1,
    });
  });
});

describe('PlanLimitGuardService', () => {
  function guard(
    limits: any,
    rows: { categories?: any[]; expenses?: any[] }
  ): PlanLimitGuardService {
    const g = Object.create(PlanLimitGuardService.prototype) as any;
    g.offlineStorage = storage(rows).service;
    g.planService = { getKnownLimits: () => limits };
    return g;
  }
  const expenses = (n: number) =>
    Array.from({ length: n }, (_, i) => mine({ _id: `e${i}`, date: thisMonth() }));

  it('lets a create through below the limit', async () => {
    const g = guard(
      { maxCategories: 5, maxTransactionsPerMonth: 3 },
      { expenses: expenses(2) }
    );
    await expectAsync(
      firstValueFrom(g.assertCanCreate('transactions'))
    ).toBeResolved();
  });

  it('refuses a create at the limit with a typed error', async () => {
    const g = guard(
      { maxCategories: 5, maxTransactionsPerMonth: 3 },
      { expenses: expenses(3) }
    );
    const error = await firstValueFrom(g.assertCanCreate('transactions')).catch(
      (e) => e
    );
    expect(error instanceof LocalPlanLimitError).toBeTrue();
    expect(isPlanLimitError(error)).toBeTrue();
    expect(error.currentCount).toBe(3);
    expect(error.maxAllowed).toBe(3);
  });

  it('never blocks when limits are unknown or unlimited', async () => {
    for (const limits of [
      null,
      { maxCategories: null, maxTransactionsPerMonth: null },
    ]) {
      const g = guard(limits, { expenses: expenses(100) });
      await expectAsync(
        firstValueFrom(g.assertCanCreate('transactions'))
      ).toBeResolved();
    }
  });
});

describe('refused operations: retry, discard and dependents', () => {
  const limitedOps = () => [
    mine({
      id: 'op-cat',
      entityType: 'category',
      entityId: 'offline_cat',
      status: SyncStatus.ERROR,
      error: 'PLAN_LIMIT_EXCEEDED',
      retryCount: 3,
      maxRetries: 3,
    }),
    mine({
      id: 'op-exp',
      entityType: 'expense',
      entityId: 'offline_exp',
      data: { category: 'offline_cat' },
      status: SyncStatus.PENDING,
      retryCount: 0,
      maxRetries: 3,
    }),
    mine({
      id: 'op-other',
      entityType: 'expense',
      entityId: 'offline_other',
      data: { category: 'real_cat' },
      status: SyncStatus.PENDING,
      retryCount: 0,
      maxRetries: 3,
    }),
  ];

  it('fails expenses of an already refused category before pushing', async () => {
    const { service, db } = storage({ ops: limitedOps() });
    expect(await service.failDependentsOfLimitedCategories()).toBe(1);
    const byId = (id: string) => db.syncOperations.rows.find((r: any) => r.id === id);
    expect(byId('op-exp').error).toBe('PLAN_LIMIT_EXCEEDED');
    expect(byId('op-other').status).toBe(SyncStatus.PENDING);
  });

  it('requeues refused operations with fresh attempts', async () => {
    const { service, db } = storage({ ops: limitedOps() });
    expect(await service.requeuePlanLimitedOperations()).toBe(1);
    expect(db.syncOperations.rows[0]).toEqual(
      jasmine.objectContaining({ status: SyncStatus.PENDING, retryCount: 0 })
    );
  });

  it('discards refused operations together with their local records', async () => {
    const { service, db } = storage({
      categories: [mine({ _id: 'offline_cat' }), mine({ _id: 'kept' })],
      ops: limitedOps(),
    });
    expect(await service.discardPlanLimitedOperations()).toBe(1);
    expect(db.categories.rows.map((r: any) => r._id)).toEqual(['kept']);
    expect(
      db.syncOperations.rows.find((r: any) => r.id === 'op-cat')
    ).toBeUndefined();
  });
});

describe('PlanService known limits', () => {
  function plans(userId = 'u1') {
    const service = Object.create(PlanService.prototype) as any;
    service.tokenService = { getUserId: () => userId };
    service.limitsIncreasedSubject = new Subject<void>();
    service.currentPlanSubject = { value: null };
    return service;
  }

  beforeEach(() => localStorage.removeItem('mf_plan_limits_u1'));

  it('keeps the last confirmed limits for offline use', () => {
    const s = plans();
    s.rememberLimits('u1', { maxCategories: 5, maxTransactionsPerMonth: 50 });
    expect(s.getKnownLimits()).toEqual({
      maxCategories: 5,
      maxTransactionsPerMonth: 50,
    });
  });

  it('signals when a limit is raised or removed, not when it shrinks', () => {
    const s = plans();
    let signals = 0;
    s.limitsIncreasedSubject.subscribe(() => signals++);
    s.rememberLimits('u1', { maxCategories: 5, maxTransactionsPerMonth: 50 });
    expect(signals).toBe(0);
    s.rememberLimits('u1', { maxCategories: 3, maxTransactionsPerMonth: 50 });
    expect(signals).toBe(0);
    s.rememberLimits('u1', { maxCategories: 10, maxTransactionsPerMonth: 50 });
    expect(signals).toBe(1);
    s.rememberLimits('u1', { maxCategories: null, maxTransactionsPerMonth: 50 });
    expect(signals).toBe(2);
  });
});
