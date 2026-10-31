import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { ExpenseService } from './expense.service';

/** Offline-first routing of the expense service: when to call the API, when to save locally. */
function harness(options: { online?: boolean } = {}) {
  const calls = { post: [] as any[], put: [] as any[], delete: [] as string[], tracked: [] as string[], savedOffline: [] as any[] };
  const service = Object.create(ExpenseService.prototype) as any;
  service.endpoint = '/expenses';
  service.expensesCache$ = 'stale-cache';
  service.totalsCache = new Map([['k', 'stale']]);
  service.expenseReconciledSubject = new Subject<void>();
  service.reconciled = 0;
  service.expenseReconciledSubject.subscribe(() => service.reconciled++);
  service.telemetry = { track: (name: string) => calls.tracked.push(name) };
  service.connectionService = { isOnline: () => options.online !== false };
  service.offlineStorage = {
    saveSyncedEntity: () => of(null),
    deleteEntity: (_type: string, id: string) => {
      calls.delete.push(id);
      return of(true);
    },
  };
  service.apiService = {
    post: (_p: string, body: any) => {
      calls.post.push(body);
      return service.nextResponse ?? of({ _id: 'server-1', ...body });
    },
    put: (_p: string, body: any) => {
      calls.put.push(body);
      return service.nextResponse ?? of({ _id: 'server-1', ...body });
    },
    delete: (p: string) => {
      calls.delete.push(p);
      return service.nextResponse ?? of({ success: true });
    },
  };
  service._saveOffline = (type: string, data: any) => {
    calls.savedOffline.push({ type, data });
    return of({ ...data, _id: data._id ?? 'offline_x' });
  };
  return { service, calls };
}

describe('ExpenseService offline-first routing', () => {
  it('saves locally when the device is offline and never calls the API', async () => {
    const { service, calls } = harness({ online: false });
    await firstValueFrom(service.createExpense({ description: 'a', amount: 1 }));
    expect(calls.post.length).toBe(0);
    expect(calls.savedOffline.map((c) => c.type)).toEqual(['CREATE']);
    expect(calls.tracked).toEqual(['transaction_added']);
  });

  it('posts online, drops stale caches and announces the change', async () => {
    const { service, calls } = harness();
    const created = (await firstValueFrom(service.createExpense({ description: 'a', amount: 1 }))) as any;
    expect(created._id).toBe('server-1');
    expect(calls.post.length).toBe(1);
    expect(service.expensesCache$).toBeNull();
    expect(service.totalsCache.size).toBe(0);
    expect(service.reconciled).toBe(1);
    expect(calls.savedOffline.length).toBe(0);
  });

  it('keeps an expense whose category was created offline in the local queue', async () => {
    const { service, calls } = harness();
    await firstValueFrom(service.createExpense({ description: 'a', amount: 1, category: 'offline_cat' }));
    expect(calls.post.length).toBe(0);
    expect(calls.savedOffline.length).toBe(1);
  });

  it('falls back to the local queue on a network failure (status 0)', async () => {
    const { service, calls } = harness();
    service.nextResponse = throwError(() => ({ status: 0 }));
    await firstValueFrom(service.createExpense({ description: 'a', amount: 1 }));
    expect(calls.savedOffline.map((c) => c.type)).toEqual(['CREATE']);
  });

  it('surfaces a server error instead of hiding it in the offline queue', async () => {
    const { service, calls } = harness();
    service.nextResponse = throwError(() => ({ status: 400, error: { message: 'bad' } }));
    await expectAsync(firstValueFrom(service.createExpense({ description: 'a', amount: 1 }))).toBeRejected();
    expect(calls.savedOffline.length).toBe(0);
  });

  it('updates locally for offline ids and online for server ids', async () => {
    const { service, calls } = harness();
    await firstValueFrom(service.updateExpense('offline_7', { amount: 3 }));
    expect(calls.put.length).toBe(0);
    expect(calls.savedOffline[0]).toEqual({ type: 'UPDATE', data: jasmine.objectContaining({ _id: 'offline_7', amount: 3 }) });

    await firstValueFrom(service.updateExpense('abc123', { amount: 4 }));
    expect(calls.put.length).toBe(1);
  });

  it('updates fall back offline only on network failure', async () => {
    const net = harness();
    net.service.nextResponse = throwError(() => ({ status: 0 }));
    await firstValueFrom(net.service.updateExpense('abc123', { amount: 4 }));
    expect(net.calls.savedOffline.length).toBe(1);

    const srv = harness();
    srv.service.nextResponse = throwError(() => ({ status: 403 }));
    await expectAsync(firstValueFrom(srv.service.updateExpense('abc123', { amount: 4 }))).toBeRejected();
    expect(srv.calls.savedOffline.length).toBe(0);
  });

  it('soft-deletes locally when offline, and reports an offline result', async () => {
    const { service, calls } = harness({ online: false });
    const result = await firstValueFrom(service.deleteExpense('abc123'));
    expect(result).toEqual({ success: true, offline: true });
    expect(calls.delete).toEqual(['abc123']);
    expect(service.reconciled).toBe(1);
  });

  it('deletes through the API when online and falls back only on network failure', async () => {
    const ok = harness();
    await firstValueFrom(ok.service.deleteExpense('abc123'));
    expect(ok.calls.delete).toContain('/expenses/abc123');

    const net = harness();
    net.service.nextResponse = throwError(() => ({ status: 0 }));
    const result = await firstValueFrom(net.service.deleteExpense('abc123'));
    expect(result).toEqual({ success: true, offline: true });

    const srv = harness();
    srv.service.nextResponse = throwError(() => ({ status: 404 }));
    await expectAsync(firstValueFrom(srv.service.deleteExpense('abc123'))).toBeRejected();
  });
});
