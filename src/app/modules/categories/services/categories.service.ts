import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { Injectable, inject } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, tap, catchError, switchMap, take } from 'rxjs/operators';
import { Category, SyncStatus } from 'src/app/shared/models';
import { CategoryParams } from '../models';
import { ApiService, ConnectionService } from 'src/app/core/services';
import { OfflineStorageService } from 'src/app/core/services/offline-storage.service';

@Injectable({
  providedIn: 'root',
})
export class CategoryService {
  private apiService = inject(ApiService);
  private readonly telemetry = inject(TelemetryService);
  private offlineStorage = inject(OfflineStorageService);
  private connectionService = inject(ConnectionService);

  private shouldQueueOffline(error: any): boolean {
    return !this.connectionService.isOnline() || error?.status === 0;
  }

  private sortCategories(categories: Category[]): Category[] {
    return [...categories].sort((a, b) => {
      const orderA = Number(a.order);
      const orderB = Number(b.order);
      const hasOrderA = Number.isFinite(orderA);
      const hasOrderB = Number.isFinite(orderB);
      if (hasOrderA && hasOrderB && orderA !== orderB) return orderA - orderB;
      if (hasOrderA !== hasOrderB) return hasOrderA ? -1 : 1;
      const titleCompare = String(a.title ?? '').localeCompare(
        String(b.title ?? ''),
        undefined,
        { sensitivity: 'base' }
      );
      return (
        titleCompare || String(a._id ?? '').localeCompare(String(b._id ?? ''))
      );
    });
  }

  getCategories(
    params: CategoryParams,
    forceRefresh = false
  ): Observable<{ data: Category[]; total: number }> {
    let httpParams = new HttpParams()
      .set('skip', params.skip.toString())
      .set('limit', params.limit.toString())
      .set('sort', params.sort);

    if (params.q) {
      httpParams = httpParams.set('q', params.q);
    }

    if (params.type) {
      httpParams = httpParams.set('type', params.type);
    }

    if (forceRefresh) {
      httpParams = httpParams.set('_t', Date.now().toString());
    }

    return this.apiService
      .get<{ data: Category[]; total: number }>('/categories/list', httpParams)
      .pipe(
        switchMap((response) => {
          return this.offlineStorage.getEntities<any>('category').pipe(
            map((localCategories) => {
              const pendingLocal = localCategories.filter(
                (c: any) => c._syncStatus === SyncStatus.PENDING
              );
              const pendingActive = pendingLocal.filter(
                (c: any) => !c._isDeleted
              );
              const pendingDeletes = new Set(
                pendingLocal
                  .filter((c: any) => c._isDeleted)
                  .flatMap((c: any) => [c._id, c._clientId].filter(Boolean))
              );

              const apiCategories = response.data || [];
              const apiIds = new Set(apiCategories.map((c: any) => c._id));
              const apiClientIds = new Set(
                apiCategories.map((c: any) => c._clientId).filter(Boolean)
              );

              let uniquePending = pendingActive.filter(
                (c: any) => !apiIds.has(c._id) && !apiClientIds.has(c._id)
              );

              if (params.type) {
                uniquePending = uniquePending.filter(
                  (c: any) => c.type === params.type
                );
              }
              if (params.q) {
                const q = params.q.toLowerCase();
                uniquePending = uniquePending.filter((c: any) =>
                  c.title?.toLowerCase().includes(q)
                );
              }

              const pendingMap = new Map(
                pendingActive.map((c: any) => [c._id, c])
              );
              const filteredApi = apiCategories
                .filter(
                  (c: any) =>
                    !pendingDeletes.has(c._id) &&
                    !pendingDeletes.has(c._clientId)
                )
                .map((c: any) => {
                  if (pendingMap.has(c._id)) return pendingMap.get(c._id);
                  if (c._clientId && pendingMap.has(c._clientId)) {
                    // Keep pending data but use the real ID
                    return { ...pendingMap.get(c._clientId), _id: c._id };
                  }
                  return c;
                });

              const merged = this.sortCategories([
                ...uniquePending,
                ...filteredApi,
              ] as Category[]);

              return {
                data: merged,
                total: merged.length,
                originalApiData: apiCategories,
              };
            })
          );
        }),
        tap(({ originalApiData }) => {
          if (originalApiData && originalApiData.length > 0) {
            this.offlineStorage
              .mergeEntities('category', originalApiData as any[])
              .subscribe();
          }
        }),
        map((result: any) => ({ data: result.data, total: result.total })),
        catchError((error) => {
          if (!this.shouldQueueOffline(error)) {
            return throwError(() => error);
          }
          return this.offlineStorage.getEntities<any>('category').pipe(
            map((categories) => {
              let filtered = categories.filter(
                (category: any) => !category._isDeleted
              );
              if (params.type) {
                filtered = filtered.filter((c) => c.type === params.type);
              }
              if (params.q) {
                const q = params.q.toLowerCase();
                filtered = filtered.filter((c: any) =>
                  c.title?.toLowerCase().includes(q)
                );
              }
              const sorted = this.sortCategories(filtered as Category[]);
              return { data: sorted, total: sorted.length };
            })
          );
        })
      );
  }

  getCategory(id: string): Observable<Category> {
    const offlineFetch$ = this.offlineStorage
      .getEntity<any>('category', id)
      .pipe(
        map((category) => {
          if (!category) throw new Error('Category not found offline');
          return category as Category;
        })
      );

    if (id.startsWith('offline_')) {
      return offlineFetch$;
    }

    return this.apiService
      .get<Category>(`/categories/${id}`)
      .pipe(
        catchError((error) =>
          this.shouldQueueOffline(error)
            ? offlineFetch$
            : throwError(() => error)
        )
      );
  }

  createCategory(categoryData: Partial<Category>): Observable<Category> {
    return this.createCategoryInternal(categoryData).pipe(
      tap(() => this.telemetry.track('category_added'))
    );
  }

  private createCategoryInternal(
    categoryData: Partial<Category>
  ): Observable<Category> {
    return this.offlineStorage.getEntities<any>('category').pipe(
      take(1),
      switchMap((existing) => {
        const maxOrder = existing.reduce(
          (max: number, category: any) =>
            Math.max(
              max,
              Number.isFinite(Number(category.order))
                ? Number(category.order)
                : -1
            ),
          -1
        );
        const payload = {
          ...categoryData,
          order: categoryData.order ?? maxOrder + 1,
        };
        return this.createCategoryWithPayload(payload);
      })
    );
  }

  private createCategoryWithPayload(
    categoryData: Partial<Category>
  ): Observable<Category> {
    if (!this.connectionService.isOnline()) {
      return this._saveOffline('CREATE', categoryData);
    }

    return this.apiService
      .post<Category>('/categories/create', categoryData)
      .pipe(
        tap((category) => {
          this.offlineStorage
            .saveSyncedEntity('category', category as any)
            .subscribe();
        }),
        catchError((error) => {
          return this.shouldQueueOffline(error)
            ? this._saveOffline('CREATE', categoryData)
            : throwError(() => error);
        })
      );
  }

  updateCategory(
    id: string,
    categoryData: Partial<Category>
  ): Observable<Category> {
    const isOnline = this.connectionService?.isOnline?.() ?? true;

    if (!isOnline || id.startsWith('offline_')) {
      return this._saveOffline('UPDATE', {
        ...categoryData,
        _id: id,
      } as Partial<Category>);
    }

    return this.apiService
      .put<Category>(`/categories/update/${id}`, categoryData)
      .pipe(
        tap((category) => {
          this.offlineStorage
            .saveSyncedEntity('category', category as any)
            .subscribe();
        }),
        catchError((error) => {
          return this.shouldQueueOffline(error)
            ? this._saveOffline('UPDATE', {
                ...categoryData,
                _id: id,
              } as Partial<Category>)
            : throwError(() => error);
        })
      );
  }

  deleteCategory(id: string): Observable<void> {
    const isOnline = this.connectionService?.isOnline?.() ?? true;

    if (!isOnline || id.startsWith('offline_')) {
      return this.offlineStorage
        .deleteEntity('category', id)
        .pipe(map(() => void 0));
    }

    return this.apiService.delete<void>(`/categories/delete/${id}`).pipe(
      tap(() => this.offlineStorage.removeEntityHard('category', id)),
      catchError((error) => {
        return this.shouldQueueOffline(error)
          ? this.offlineStorage
              .deleteEntity('category', id)
              .pipe(map(() => void 0))
          : throwError(() => error);
      })
    );
  }

  updateOrder(
    categories: { categoryId: string; order: number }[]
  ): Observable<void> {
    return this.apiService.put<void>('/categories/update-order', {
      categories,
    });
  }

  private _saveOffline(
    type: 'CREATE' | 'UPDATE',
    category: Partial<Category>
  ): Observable<Category> {
    const offlineEntity: any = {
      ...category,
      _id: category['_id' as keyof Category] || this._generateOfflineId(),
      _syncStatus: 'PENDING',
      _isDeleted: false,
      _lastModified: new Date(),
    };
    return this.offlineStorage
      .saveEntity(
        'category',
        {
          ...offlineEntity,
          _clientId: offlineEntity._clientId || offlineEntity._id,
        },
        type
      )
      .pipe(map((saved) => saved as unknown as Category));
  }

  private _generateOfflineId(): string {
    return (
      'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    );
  }
}
