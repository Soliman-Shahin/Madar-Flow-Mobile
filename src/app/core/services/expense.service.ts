import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { Injectable, inject } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { Observable, Subject, throwError, from, of } from 'rxjs';
import { catchError, shareReplay, tap, switchMap, map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { Expense } from 'src/app/shared/models/expense.model';
import { AuthService } from 'src/app/modules/auth/services/auth.service';
import { OfflineStorageService } from './offline-storage.service';
import { ConnectionService } from './connection.service';
import { SyncStatus } from 'src/app/shared/models/sync.model';
import { invalidateHttpCache } from '../interceptors/cache.interceptor';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ExpenseService {
  private readonly expenseReconciledSubject = new Subject<void>();
  readonly expenseReconciled$ = this.expenseReconciledSubject.asObservable();

  private readonly endpoint = '/expenses';
  // Cache the expenses list to prevent duplicate network calls across widgets
  private expensesCache$: Observable<Expense[]> | null = null;
  // Cache for totals requests keyed by date range
  private totalsCache = new Map<
    string,
    Observable<{ income: number; expenses: number }>
  >();

  private readonly telemetry = inject(TelemetryService);
  private apiService = inject(ApiService);
  private auth = inject(AuthService);
  private offlineStorage = inject(OfflineStorageService);
  private connectionService = inject(ConnectionService);

  private shouldFallbackOffline(error: any): boolean {
    // Angular HttpErrorResponse uses status 0 for transport failures
    // (offline, refused connection, timeout, or another network error).
    // A server response must remain a server/UI error even if connectivity
    // state is stale.
    return error?.status === 0;
  }

  private normalizeExpenseResponse(response: any): Expense[] {
    if (Array.isArray(response)) return response as Expense[];
    if (Array.isArray(response?.data)) return response.data as Expense[];
    if (Array.isArray(response?.expenses)) return response.expenses as Expense[];
    return [];
  }

  constructor() {
    // Clear caches when auth user changes (login/logout) to avoid stale/unauthenticated results
    this.auth.userChanges.subscribe(() => {
      this.expensesCache$ = null;
      this.totalsCache.clear();
      this.expenseReconciledSubject.next();
    });
  }

  notifyExpenseReconciled(): void {
    this.expensesCache$ = null;
    this.totalsCache.clear();
    this.expenseReconciledSubject.next();
  }

  /** Returns counts over the owner's full merged expense dataset, not a filtered page. */
  getCategoryUsageCounts(): Observable<Record<string, number>> {
    return this.getExpenses().pipe(
      map((expenses) => {
        const counts: Record<string, number> = {};
        for (const expense of expenses) {
          if ((expense as any)._isDeleted) continue;
          const category = expense.category as any;
          const categoryId =
            typeof category === 'object' ? category?._id : category;
          if (categoryId)
            counts[String(categoryId)] = (counts[String(categoryId)] || 0) + 1;
        }
        return counts;
      })
    );
  }

  getExpenses(params?: any, forceRefresh = false): Observable<Expense[]> {
    // If we have params (filters), don't use cache
    if (params && Object.keys(params).length > 0) {
      let httpParams = new HttpParams();
      Object.keys(params).forEach((key) => {
        if (
          params[key] !== null &&
          params[key] !== undefined &&
          params[key] !== ''
        ) {
          httpParams = httpParams.set(key, params[key]);
        }
      });

      // Add cache-busting parameter if forceRefresh is true
      if (forceRefresh) {
        httpParams = httpParams.set('_t', Date.now().toString());
      }

      return this.apiService.get<any>(this.endpoint, httpParams).pipe(
        map((response) => this.normalizeExpenseResponse(response)),
        switchMap((expenses) => {
          return this.offlineStorage.getEntities<any>('expense').pipe(
            map((localExpenses) => {
              const pendingLocal = localExpenses.filter(
                (e) => e._syncStatus === SyncStatus.PENDING
              );
              const pendingActive = pendingLocal.filter((e) => !e._isDeleted);
              const pendingDeletes = new Set(
                pendingLocal
                  .filter((e) => e._isDeleted)
                  .flatMap((e) => [e._id, e._clientId].filter(Boolean))
              );

              const apiIds = new Set(expenses.map((e) => e._id));
              const apiClientIds = new Set(
                expenses.map((e) => (e as any)._clientId).filter(Boolean)
              );
              let uniquePending = pendingActive.filter(
                (e) => !apiIds.has(e._id) && !apiClientIds.has(e._id)
              );

              // Basic rudimentary filtering for pending items so they somewhat match the query
              if (params.startDate && params.endDate) {
                const start = new Date(params.startDate).getTime();
                const end = new Date(params.endDate).getTime();
                uniquePending = uniquePending.filter((e) => {
                  const d = new Date(e.date).getTime();
                  return d >= start && d <= end;
                });
              }
              if (params.category) {
                uniquePending = uniquePending.filter((e) => {
                  const catId =
                    typeof e.category === 'object'
                      ? e.category._id
                      : e.category;
                  return catId === params.category;
                });
              }

              const pendingMap = new Map(pendingActive.map((e) => [e._id, e]));
              const filteredApi = expenses
                .filter(
                  (e) =>
                    !pendingDeletes.has(e._id) &&
                    !pendingDeletes.has((e as any)._clientId)
                )
                .map((e) => {
                  if (pendingMap.has(e._id)) return pendingMap.get(e._id);
                  if (
                    (e as any)._clientId &&
                    pendingMap.has((e as any)._clientId)
                  ) {
                    return {
                      ...pendingMap.get((e as any)._clientId),
                      _id: e._id,
                    };
                  }
                  return e;
                });
              const merged = [...uniquePending, ...filteredApi] as Expense[];
              merged.sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime()
              );

              return { apiExpenses: expenses, mergedExpenses: merged };
            })
          );
        }),
        tap(({ apiExpenses }) => {
          if (apiExpenses && apiExpenses.length > 0) {
            this.offlineStorage
              .mergeEntities('expense', apiExpenses as any[])
              .subscribe();
          }
        }),
        map(({ mergedExpenses }) => mergedExpenses),
        catchError((error) => {
          if (!this.shouldFallbackOffline(error)) {
            return throwError(() => error);
          }
          return this.offlineStorage.getEntities<any>('expense').pipe(
            map((localExpenses) => {
              let filtered = (localExpenses as Expense[]).filter(
                (e: any) => !e._isDeleted
              );
              if (params?.startDate && params?.endDate) {
                const start = new Date(params.startDate).getTime();
                const end = new Date(params.endDate).getTime();
                filtered = filtered.filter((e) => {
                  const d = new Date(e.date).getTime();
                  return d >= start && d <= end;
                });
              }
              if (params?.category) {
                filtered = filtered.filter((e) => {
                  const catId =
                    typeof e.category === 'object'
                      ? e.category._id
                      : e.category;
                  return catId === params.category;
                });
              }
              filtered.sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime()
              );
              return filtered;
            })
          );
        })
      );
    }

    // Use cache for regular requests without filters
    if (!this.expensesCache$ || forceRefresh) {
      this.expensesCache$ = this.apiService.get<any>(this.endpoint).pipe(
        map((response) => this.normalizeExpenseResponse(response)),
        switchMap((expenses) => {
          return this.offlineStorage.getEntities<any>('expense').pipe(
            map((localExpenses) => {
              const pendingLocal = localExpenses.filter(
                (e) => e._syncStatus === SyncStatus.PENDING
              );

              // Find pending creates/updates
              const pendingActive = pendingLocal.filter((e) => !e._isDeleted);
              // Find pending deletes
              const pendingDeletes = new Set(
                pendingLocal
                  .filter((e) => e._isDeleted)
                  .flatMap((e) => [e._id, e._clientId].filter(Boolean))
              );

              // Filter out API items that were deleted locally but not yet synced
              const apiIds = new Set(expenses.map((e) => e._id));
              const apiClientIds = new Set(
                expenses.map((e) => (e as any)._clientId).filter(Boolean)
              );
              const uniquePending = pendingActive.filter(
                (e) => !apiIds.has(e._id) && !apiClientIds.has(e._id)
              );

              const pendingMap = new Map(pendingActive.map((e) => [e._id, e]));
              const filteredApi = expenses
                .filter(
                  (e) =>
                    !pendingDeletes.has(e._id) &&
                    !pendingDeletes.has((e as any)._clientId)
                )
                .map((e) => {
                  if (pendingMap.has(e._id)) return pendingMap.get(e._id);
                  if (
                    (e as any)._clientId &&
                    pendingMap.has((e as any)._clientId)
                  ) {
                    return {
                      ...pendingMap.get((e as any)._clientId),
                      _id: e._id,
                    };
                  }
                  return e;
                });

              const merged = [...uniquePending, ...filteredApi] as Expense[];
              // Sort by date descending
              merged.sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime()
              );

              return { apiExpenses: expenses, mergedExpenses: merged };
            })
          );
        }),
        tap(({ apiExpenses }) => {
          // Save to offline storage for backup
          if (apiExpenses && apiExpenses.length > 0) {
            this.offlineStorage
              .mergeEntities('expense', apiExpenses as any[])
              .subscribe();
          }
        }),
        map(({ mergedExpenses }) => mergedExpenses),
        catchError((error) => {
          if (!this.shouldFallbackOffline(error)) {
            return throwError(() => error);
          }
          this.expensesCache$ = null; // clear cache so next online call refetches
          return this.offlineStorage
            .getEntities<any>('expense')
            .pipe(
              map((localExpenses) =>
                (localExpenses as Expense[]).filter(
                  (expense: any) => !expense._isDeleted
                )
              )
            );
        }),
        // Do not cache error emissions
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.expensesCache$;
  }

  getExpense(id: string): Observable<Expense> {
    const offlineFetch$ = this.offlineStorage
      .getEntity<any>('expense', id)
      .pipe(
        switchMap((local) => {
          if (local) return of(local as Expense);
          return throwError(() => new Error('Expense not found offline'));
        })
      );

    if (id.startsWith('offline_')) {
      return offlineFetch$;
    }

    return this.apiService
      .get<Expense>(`${this.endpoint}/${id}`)
      .pipe(
        catchError((error) =>
          this.shouldFallbackOffline(error)
            ? offlineFetch$
            : throwError(() => error)
        )
      );
  }

  createExpense(expense: Partial<Expense>): Observable<Expense> {
    return this.createExpenseInternal(expense).pipe(
      tap(() => this.telemetry.track('transaction_added'))
    );
  }

  private createExpenseInternal(expense: Partial<Expense>): Observable<Expense> {
    const isOnline = this.connectionService.isOnline();

    // If it's an offline category, we cannot send it directly to the server!
    // We must save it locally so SyncService handles it in a batch.
    const hasOfflineCategory =
      expense.category && expense.category.toString().startsWith('offline_');

    if (!isOnline || hasOfflineCategory) {
      // 🔌 Offline: Save locally with PENDING status
      return this._saveOffline('CREATE', expense);
    }

    return this.apiService.post<Expense>(`${this.endpoint}`, expense).pipe(
      tap((createdExpense) => {
        this.expensesCache$ = null;
        this.totalsCache.clear();
        invalidateHttpCache('/expenses');
        // Mirror to offline storage (marked as SYNCED)
        this.offlineStorage
          .saveSyncedEntity('expense', {
            ...createdExpense,
            _syncStatus: SyncStatus.SYNCED,
          } as any)
          .subscribe();
        this.expenseReconciledSubject.next();
      }),
      catchError((error) => {
        return this.shouldFallbackOffline(error)
          ? this._saveOffline('CREATE', expense)
          : throwError(() => error);
      })
    );
  }

  updateExpense(id: string, expense: Partial<Expense>): Observable<Expense> {
    const isOnline = this.connectionService.isOnline();

    // If it's an offline ID, or if it has an offline category, we cannot send it to the server directly via PUT.
    // We must update it locally and let the sync engine push it later.
    const hasOfflineCategory =
      expense.category && expense.category.toString().startsWith('offline_');

    if (!isOnline || id.startsWith('offline_') || hasOfflineCategory) {
      // 🔌 Offline: update locally with PENDING status
      return this._saveOffline('UPDATE', { ...expense, _id: id });
    }

    return this.apiService.put<Expense>(`${this.endpoint}/${id}`, expense).pipe(
      tap((updatedExpense) => {
        this.expensesCache$ = null;
        this.totalsCache.clear();
        invalidateHttpCache('/expenses');
        this.offlineStorage
          .saveSyncedEntity('expense', {
            ...updatedExpense,
            _syncStatus: SyncStatus.SYNCED,
          } as any)
          .subscribe();
        this.expenseReconciledSubject.next();
      }),
      catchError((error) => {
        return this.shouldFallbackOffline(error)
          ? this._saveOffline('UPDATE', { ...expense, _id: id })
          : throwError(() => error);
      })
    );
  }

  deleteExpense(id: string): Observable<any> {
    const isOnline = this.connectionService.isOnline();

    if (!isOnline || id.startsWith('offline_')) {
      // 🔌 Offline: soft delete locally
      return this.offlineStorage.deleteEntity('expense', id).pipe(
        tap(() => {
          this.expensesCache$ = null;
          this.totalsCache.clear();
          invalidateHttpCache('/expenses');
          this.expenseReconciledSubject.next();
        }),
        map(() => ({ success: true, offline: true }))
      );
    }

    return this.apiService.delete(`${this.endpoint}/${id}`).pipe(
      tap(() => {
        this.expensesCache$ = null;
        this.totalsCache.clear();
        invalidateHttpCache('/expenses');
        // Also mark as deleted in local storage
        this.offlineStorage.deleteEntity('expense', id).subscribe();
        this.expenseReconciledSubject.next();
      }),
      catchError((error) => {
        if (!this.shouldFallbackOffline(error)) {
          return throwError(() => error);
        }
        return this.offlineStorage.deleteEntity('expense', id).pipe(
          tap(() => {
            this.expensesCache$ = null;
            this.totalsCache.clear();
            invalidateHttpCache('/expenses');
            this.expenseReconciledSubject.next();
          }),
          map(() => ({ success: true, offline: true }))
        );
      })
    );
  }

  getTotals(
    startDate: Date,
    endDate: Date
  ): Observable<{ income: number; expenses: number }> {
    const key = `${startDate.toISOString()}|${endDate.toISOString()}`;
    const existing = this.totalsCache.get(key);
    if (existing) return existing;

    const params = new HttpParams()
      .set('startDate', startDate.toISOString())
      .set('endDate', endDate.toISOString());

    const req$ = this.apiService
      .get<{ income: number; expenses: number }>(
        `${this.endpoint}/totals`,
        params
      )
      .pipe(
        catchError((error) => {
          return this.shouldFallbackOffline(error)
            ? this._computeOfflineTotals(startDate, endDate)
            : throwError(() => error);
        }),
        // Do not cache error emissions
        shareReplay({ bufferSize: 1, refCount: true })
      );
    this.totalsCache.set(key, req$);
    return req$;
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Saves an expense offline as a PENDING entity for later sync.
   */
  private _saveOffline(
    type: 'CREATE' | 'UPDATE',
    expense: Partial<Expense>
  ): Observable<Expense> {
    const offlineEntity: any = {
      ...expense,
      _id: expense['_id' as keyof Expense] || this._generateOfflineId(),
      _syncStatus: SyncStatus.PENDING,
      _lastModified: new Date(),
      _version: 1,
      _isDeleted: false,
    };

    offlineEntity._clientId = offlineEntity._clientId || offlineEntity._id;
    return this.offlineStorage.saveEntity('expense', offlineEntity, type).pipe(
      tap(() => {
        this.expensesCache$ = null;
        this.totalsCache.clear();
        invalidateHttpCache('/expenses');
        this.expenseReconciledSubject.next();
      }),
      map((saved) => saved as unknown as Expense)
    );
  }

  /**
   * Computes income/expense totals from local IndexedDB for the given date range.
   */
  private _computeOfflineTotals(
    startDate: Date,
    endDate: Date
  ): Observable<{ income: number; expenses: number }> {
    return this.offlineStorage.getEntities<any>('expense').pipe(
      map((expenses) => {
        const filtered = expenses.filter((e: any) => {
          const d = new Date(e.date);
          return d >= startDate && d <= endDate && !e._isDeleted;
        });

        return filtered.reduce(
          (acc: { income: number; expenses: number }, e: any) => {
            const amount = Number(e.amount) || 0;
            // category can be a string ID or populated object
            const catType =
              typeof e.category === 'object' ? e.category?.type : undefined;

            if (catType === 'income') {
              acc.income += amount;
            } else {
              acc.expenses += amount;
            }
            return acc;
          },
          { income: 0, expenses: 0 }
        );
      })
    );
  }

  /**
   * Generates a temporary local ID for offline-created entities.
   * Will be replaced by the server's real _id after sync.
   */
  private _generateOfflineId(): string {
    return `offline_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
  }
}
