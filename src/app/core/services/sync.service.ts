import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  BehaviorSubject,
  from,
  of,
  interval,
  throwError,
  Subscription,
  firstValueFrom,
} from 'rxjs';
import {
  map,
  switchMap,
  catchError,
  tap,
  filter,
  finalize,
  distinctUntilChanged,
} from 'rxjs/operators';
import { ApiService } from './api.service';
import { OfflineStorageService } from './offline-storage.service';
import { ConnectionService } from './connection.service';
import { ExpenseService } from './expense.service';
import { environment } from 'src/environments/environment';
import { TokenService } from 'src/app/modules/auth/services/token.service';
import {
  SyncStatus,
  SyncMetadata,
  SyncConfig,
  SyncProgress,
  SyncIndicatorState,
} from 'src/app/shared/models/sync.model';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

/**
 * 🔄 Sync Service - Professional Implementation
 *
 * المسؤوليات:
 * 1. مزامنة البيانات بين الفرونت والباك (Pull & Push)
 * 2. إدارة الـ Offline Mode
 * 3. معالجة التعارضات (Conflicts)
 * 4. تتبع حالة المزامنة (Metadata & Progress)
 */
@Injectable({
  providedIn: 'root',
})
export class SyncService {
  private apiService = inject(ApiService);
  private offlineStorage = inject(OfflineStorageService);
  private connectionService = inject(ConnectionService);
  private expenseService = inject(ExpenseService);
  private tokenService = inject(TokenService);
  private readonly telemetry = inject(TelemetryService);

  // ==================== CONFIGURATION ====================

  private syncConfig: SyncConfig = {
    autoSync: true,
    syncInterval: 300000, // 5 minutes
    maxRetries: 3,
    conflictResolution: 'prompt',
    batchSize: 50,
    enableOfflineMode: true,
  };

  // ==================== OBSERVABLES ====================

  private syncMetadataSubject = new BehaviorSubject<SyncMetadata>({
    lastSyncTime: null,
    totalEntities: 0,
    pendingCount: 0,
    conflictCount: 0,
    errorCount: 0,
    isOnline: false,
    isSyncing: false,
  });

  private syncProgressSubject = new BehaviorSubject<SyncProgress>({
    current: 0,
    total: 0,
    percentage: 0,
    currentOperation: '',
    isComplete: true,
    errors: [],
  });

  public syncMetadata$ = this.syncMetadataSubject.asObservable();
  public syncProgress$ = this.syncProgressSubject.asObservable();
  public readonly syncIndicatorState$: Observable<SyncIndicatorState> =
    this.syncMetadata$.pipe(
      map((metadata) => ({
        pendingCount: metadata.pendingCount,
        errorCount: metadata.errorCount,
        isSyncing: metadata.isSyncing,
        isOffline: !metadata.isOnline,
        hasPendingChanges: metadata.pendingCount > 0 || metadata.errorCount > 0,
        hasSyncErrors: metadata.errorCount > 0,
      })),
      distinctUntilChanged(
        (a, b) =>
          a.pendingCount === b.pendingCount &&
          a.errorCount === b.errorCount &&
          a.isSyncing === b.isSyncing &&
          a.isOffline === b.isOffline
      )
    );

  // ==================== STATE ====================

  private isOnline = false;
  private syncInProgress = false;
  private syncOwnerId: string | null = null;
  private autoSyncSubscription?: Subscription;

  /** Key used to persist lastSyncTime in localStorage as fallback */
  private readonly LAST_SYNC_KEY = 'sync_lastSyncTime';

  // ==================== INITIALIZATION ====================

  constructor() {
    this.loadConfig();
    this.loadLastSyncTime();
    this.initializeNetworkMonitoring();
    this.initializeAutoSync();
    this.initializeQueueMonitoring();
  }

  private initializeQueueMonitoring(): void {
    // Monitor offline queue and update metadata
    this.offlineStorage.syncQueue$.subscribe((queue) => {
      const pendingCount = queue.operations.filter(
        (op) => op.status === SyncStatus.PENDING
      ).length;
      const errorCount = queue.operations.filter(
        (op) => op.status === SyncStatus.ERROR
      ).length;

      this.updateSyncMetadata({
        pendingCount,
        errorCount,
      });

      // Also update total entities count occasionally
      this.offlineStorage.getStorageSize().subscribe((totalEntities) => {
        this.updateSyncMetadata({ totalEntities });
      });
    });
  }

  private loadConfig(): void {
    try {
      const stored = localStorage.getItem('sync_config');
      if (stored) {
        this.syncConfig = { ...this.syncConfig, ...JSON.parse(stored) };
        this.syncConfig.syncInterval = [60000, 300000, 900000].includes(
          this.syncConfig.syncInterval
        )
          ? this.syncConfig.syncInterval
          : 300000;
        this.syncConfig.maxRetries = Math.min(
          10,
          Math.max(1, this.syncConfig.maxRetries || 3)
        );
        this.syncConfig.batchSize = Math.min(
          100,
          Math.max(1, this.syncConfig.batchSize || 50)
        );
        debugLog('⚙️ Loaded sync config:', this.syncConfig);
      }
    } catch (e) {
      console.warn('Could not load sync config', e);
    }
  }

  /**
   * مراقبة حالة الاتصال - مربوط بـ ConnectionService للدقة الكاملة
   * يستخدم backendReachable (health check) وليس navigator.onLine فقط
   */
  private initializeNetworkMonitoring(): void {
    this.connectionService
      .getConnectionStatus()
      .pipe(
        map((status) => status.online && status.backendReachable),
        distinctUntilChanged()
      )
      .subscribe((isOnline) => {
        const wasOnline = this.isOnline;
        this.isOnline = isOnline;
        this.updateSyncMetadata({ isOnline });

        debugLog(
          '📡 Connection changed:',
          wasOnline ? 'Online' : 'Offline',
          '→',
          isOnline ? 'Online (backend reachable)' : 'Offline'
        );

        // Auto-sync when coming back online (backend is reachable)
        if (!wasOnline && isOnline && this.syncConfig.autoSync) {
          debugLog('🔄 Connection restored, starting auto-sync...');
          // Small delay to let connection stabilize
          setTimeout(() => {
            this.syncAll().subscribe({
              next: (success) =>
                debugLog('✅ Auto-sync completed:', success),
              error: (err) => console.error('❌ Auto-sync failed:', err),
            });
          }, 1500);
        }
      });
  }

  /**
   * تفعيل المزامنة التلقائية
   */
  private initializeAutoSync(): void {
    this.autoSyncSubscription?.unsubscribe();
    this.autoSyncSubscription = undefined;
    if (this.syncConfig.autoSync && this.syncConfig.syncInterval > 0) {
      this.autoSyncSubscription = interval(this.syncConfig.syncInterval)
        .pipe(
          filter(() => this.isOnline && !this.syncInProgress),
          switchMap(() => {
            debugLog('⏰ Auto-sync triggered');
            return this.syncAll();
          })
        )
        .subscribe({
          next: (success) =>
            debugLog('✅ Auto-sync:', success ? 'Success' : 'Failed'),
          error: (err) => console.error('❌ Auto-sync error:', err),
        });
    }
  }

  // ==================== MAIN SYNC OPERATION ====================

  /**
   * 🔄 المزامنة الكاملة (Full Sync)
   *
   * الخطوات:
   * 1. Pull البيانات من السيرفر
   * 2. دمجها مع البيانات المحلية
   * 3. Push التغييرات المحلية إلى السيرفر
   */
  syncAll(): Observable<boolean> {
    // Check if sync is already running
    if (this.syncInProgress) {
      debugLog('⚠️ Sync already in progress, skipping...');
      return of(false);
    }

    // Check if online
    if (!this.isOnline) {
      debugLog('⚠️ Device is offline, cannot sync');
      return of(false);
    }

    // Start sync
    this.syncInProgress = true;
    this.syncOwnerId = String(this.tokenService.getUserId() || '');
    if (!this.syncOwnerId) {
      this.syncInProgress = false;
      return of(false);
    }
    this.updateSyncMetadata({ isSyncing: true });
    this.updateSyncProgress({
      current: 0,
      total: 100,
      percentage: 0,
      currentOperation: 'Starting sync...',
      isComplete: false,
      errors: [],
    });

    debugLog('🔄 Starting full sync...');

    // Step 1: Push local pending changes to server
    return this.pushLocalChanges().pipe(
      tap(() => {
        if (this.syncOwnerId !== String(this.tokenService.getUserId() || '')) {
          throw new Error('SYNC_OWNER_CHANGED');
        }
        this.updateSyncProgress({
          current: 33,
          percentage: 33,
          currentOperation: 'Pushing local changes...',
        });
      }),
      switchMap((pushSucceeded) => {
        if (!pushSucceeded) return of(false);
        // Step 2: Pull latest data from server
        return this.pullDataFromServer().pipe(
          tap(() => {
            this.updateSyncProgress({
              current: 66,
              percentage: 66,
              currentOperation: 'Pulling data from server...',
            });
          }),
          switchMap((pullResult) => {
            debugLog(
              `✅ Pulled ${
                pullResult.entities?.length || 0
              } entities from server`
            );

            // Step 3: Merge with local data
            return this.mergeWithLocalData(pullResult.entities || []).pipe(
              tap(() => {
                this.updateSyncProgress({
                  current: 90,
                  percentage: 90,
                  currentOperation: 'Merging data...',
                });
              })
            );
          })
        );
      }),
      tap(() => {
        this.updateSyncProgress({
          current: 100,
          percentage: 100,
          currentOperation: 'Sync completed',
          isComplete: true,
        });
        this.completeSync();
      }),
      map(() => true),
      catchError((error) => {
        console.error('❌ Sync error:', error);
        this.updateSyncProgress({
          errors: [error.message || 'Unknown sync error'],
          isComplete: true,
        });
        return of(false);
      }),
      finalize(() => {
        const ownerStillActive =
          !!this.syncOwnerId &&
          this.syncOwnerId === String(this.tokenService.getUserId() || '');
        this.syncInProgress = false;
        this.syncOwnerId = null;
        if (ownerStillActive) this.updateSyncMetadata({ isSyncing: false });
        debugLog('🏁 Sync process finished');
      })
    );
  }

  // ==================== PULL DATA FROM SERVER ====================

  /**
   * 📥 Pull البيانات من السيرفر
   */
  private pullDataFromServer(): Observable<any> {
    const lastSyncTime = this.syncMetadataSubject.value.lastSyncTime;

    debugLog('📥 Pulling data from server...');
    debugLog('📅 Last sync time:', lastSyncTime);

    return this.apiService
      .get<any>('/sync/pull', {
        lastSyncTime: lastSyncTime?.toISOString(),
        limit: this.syncConfig.batchSize,
      })
      .pipe(
        tap((response) => {
          debugLog('✅ Pull response:', {
            entitiesCount: response.entities?.length || 0,
            conflicts: response.conflicts?.length || 0,
            totalCount: response.totalCount,
          });
        }),
        catchError((error) => {
          console.error('❌ Pull error:', error);
          return throwError(() => error);
        })
      );
  }

  // ==================== MERGE WITH LOCAL DATA ====================

  /**
   * 🔀 دمج البيانات من السيرفر مع البيانات المحلية
   */
  private mergeWithLocalData(serverEntities: any[]): Observable<boolean> {
    if (!serverEntities || serverEntities.length === 0) {
      debugLog('ℹ️ No server entities to merge');
      return of(true);
    }

    debugLog(
      `🔀 Merging ${serverEntities.length} entities with local data...`
    );

    // Group entities by type
    const expenseEntities = serverEntities.filter(
      (e) => e._entityType === 'expense' || e._entityType === 'outcome'
    );
    const categoryEntities = serverEntities.filter(
      (e) => e._entityType === 'category'
    );

    const mergeObservables: Observable<any>[] = [];

    // Merge expenses
    if (expenseEntities.length > 0) {
      debugLog(`💰 Merging ${expenseEntities.length} expenses...`);
      mergeObservables.push(
        this.offlineStorage.mergeEntities('expense', expenseEntities)
      );
    }

    // Merge categories
    if (categoryEntities.length > 0) {
      debugLog(`📁 Merging ${categoryEntities.length} categories...`);
      mergeObservables.push(
        this.offlineStorage.mergeEntities('category', categoryEntities)
      );
    }

    if (mergeObservables.length === 0) {
      return of(true);
    }

    return from(
      Promise.all(mergeObservables.map((obs) => obs.toPromise()))
    ).pipe(
      map(() => {
        debugLog('✅ Merge completed');
        return true;
      }),
      catchError((error) => {
        console.error('❌ Merge error:', error);
        return throwError(() => error);
      })
    );
  }

  // ==================== PUSH LOCAL CHANGES ====================

  /**
   * 📤 Push التغييرات المحلية إلى السيرفر
   */
  private pushLocalChanges(): Observable<boolean> {
    debugLog('📤 Checking for pending local changes...');

    return this.offlineStorage.getPendingOperations().pipe(
      switchMap((operations) => {
        if (!operations || operations.length === 0) {
          debugLog('ℹ️ No pending operations to push');
          return of(true);
        }

        const batch = operations
          .sort(
            (a, b) =>
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          )
          .slice(0, this.syncConfig.batchSize);
        debugLog(`📤 Pushing ${batch.length} pending operations...`);

        // Convert operations to entities format
        const entities = batch.map((op) => ({
          ...op.data,
          _id: op.entityId,
          _entityType: op.entityType,
          _lastModified: op.timestamp,
          _version: 1,
          _baseVersion: op.baseServerVersion ?? op.data?._serverVersion,
          _isDeleted: op.type === 'DELETE',
          _operationId: op.id,
          _operationType: op.type,
          _receiptId: op.receiptId,
        }));
        // CRITICAL: Sort entities so that categories come first.
        // This ensures the backend resolves offline category IDs and puts them in idMap
        // BEFORE it processes expenses that depend on those categories.
        entities.sort((a, b) => {
          if (a._entityType === 'category' && b._entityType !== 'category')
            return -1;
          if (a._entityType !== 'category' && b._entityType === 'category')
            return 1;
          return 0;
        });

        const failureUpdates: Promise<unknown>[] = [];

        return this.apiService.post<any>('/sync/push', { entities }).pipe(
          switchMap((result) =>
            from(Promise.all(batch.map((op) => {
              const receipt = result?.receipts?.[op.id];
              return receipt ? this.offlineStorage.persistSyncReceipt(op.id, receipt) : Promise.resolve();
            }))).pipe(map(() => result))
          ),
          switchMap((result) =>
            from(
              Promise.all(
                result?.success
                  ? batch.map(async (op) => {
                      if (
                        this.syncOwnerId !==
                        String(this.tokenService.getUserId() || '')
                      ) {
                        throw new Error('SYNC_OWNER_CHANGED');
                      }
                      const serverId = result?.idMap?.[op.entityId];
                      if (serverId) {
                        const reconciled = await firstValueFrom(
                          this.offlineStorage.reconcileServerId(
                            op.entityType,
                            op.entityId,
                            serverId
                          )
                        );
                        if (op.entityType === 'expense') {
                          this.expenseService.notifyExpenseReconciled();
                        }
                      }
                    })
                  : []
              )
            ).pipe(map(() => result))
          ),
          tap((result) => {
            debugLog('✅ Push result:', result);

            // Remove successful operations from queue
            if (result?.success) {
              const conflictedIds = new Set(
                (result?.conflicts || []).map((conflict: any) =>
                  String(conflict._id)
                )
              );
              const failed = new Map(
                (result?.errors || []).map((error: any) => [
                  error.operationId,
                  error.reason,
                ])
              );
              batch.forEach((op) => {
                if (conflictedIds.has(String(op.entityId))) {
                  const conflict = (result?.conflicts || []).find(
                    (item: any) => String(item._id) === String(op.entityId)
                  );
                  this.offlineStorage.blockSyncOperation(
                    op.id,
                    String(conflict?.conflictId || conflict?.dedupeKey || '')
                  );
                  this.offlineStorage.markConflict(op.entityType, op.entityId);
                  return;
                }
                const mappedServerId = result?.idMap?.[op.entityId];
                if (
                  op.type === 'CREATE' &&
                  !mappedServerId &&
                  !failed.has(op.id)
                ) {
                  failureUpdates.push(
                    this.offlineStorage.recordSyncFailure(
                      op.id,
                      'CREATE_CORRELATION_MISSING'
                    )
                  );
                  return;
                }
                if (failed.has(op.id)) {
                  failureUpdates.push(
                    this.offlineStorage.recordSyncFailure(op.id)
                  );
                  return;
                }
                this.offlineStorage.removeFromSyncQueue(op.id);
                const serverVersion =
                  op.type === 'CREATE'
                    ? 1
                    : (op.baseServerVersion ?? op.data?._serverVersion ?? 0) +
                      1;
                if (mappedServerId) {
                  this.offlineStorage.markSynced(
                    op.entityType,
                    mappedServerId,
                    serverVersion
                  );
                } else {
                  this.offlineStorage.markSynced(
                    op.entityType,
                    op.entityId,
                    serverVersion
                  );
                }
              });
            }

            // Update conflict count if any
            if (result?.conflicts && result.conflicts.length > 0) {
              this.updateSyncMetadata({
                conflictCount: result.conflicts.length,
              });
            }
          }),
          switchMap((result) =>
            from(Promise.all(failureUpdates)).pipe(map(() => result))
          ),
          switchMap((result) => {
            if (!result?.success) return of(false);
            // Continue until the owner-scoped queue is drained; a single configured
            // batch must never make later operations wait for a future scheduler tick.
            return batch.length < operations.length
              ? this.pushLocalChanges()
              : of(true);
          }),
          catchError((error) => {
            console.error('❌ Push error:', error);
            this.updateSyncProgress({
              errors: [error.message || 'Push failed'],
            });
            return throwError(() => error);
          })
        );
      })
    );
  }

  // ==================== SYNC COMPLETION ====================

  /**
   * ✅ إكمال المزامنة وحفظ الوقت بشكل دائم
   */
  private completeSync(): void {
    const now = new Date();
    this.updateSyncMetadata({
      lastSyncTime: now,
      isSyncing: false,
    });

    this.updateSyncProgress({
      isComplete: true,
      currentOperation: 'Sync completed',
      percentage: 100,
    });

    // 💾 Persist lastSyncTime so it survives app restarts
    this.persistLastSyncTime(now);

    debugLog('✅ Sync completed at:', now);
    this.telemetry.track('sync_completed');
  }

  /**
   * 💾 حفظ آخر وقت مزامنة في localStorage
   */
  private persistLastSyncTime(time: Date): void {
    try {
      localStorage.setItem(this.LAST_SYNC_KEY, time.toISOString());
    } catch (e) {
      console.warn('Could not persist lastSyncTime', e);
    }
  }

  /**
   * 📂 تحميل آخر وقت مزامنة محفوظ عند بدء التشغيل
   */
  private loadLastSyncTime(): void {
    try {
      const stored = localStorage.getItem(this.LAST_SYNC_KEY);
      if (stored) {
        const lastSyncTime = new Date(stored);
        if (!isNaN(lastSyncTime.getTime())) {
          this.updateSyncMetadata({ lastSyncTime });
          debugLog('📂 Loaded lastSyncTime:', lastSyncTime);
        }
      }
    } catch (e) {
      console.warn('Could not load lastSyncTime', e);
    }
  }

  // ==================== MANUAL SYNC TRIGGERS ====================

  /**
   * 🔄 Force Sync (Manual)
   */
  forceSync(): Observable<boolean> {
    debugLog('🔄 Force sync requested');
    return this.syncAll();
  }

  // ==================== CONFLICT RESOLUTION ====================

  /**
   * حل التعارض
   */
  resolveConflict(resolution: any): Observable<boolean> {
    debugLog('🔧 Resolving conflict:', resolution);

    if (!this.isOnline) {
      console.warn('⚠️ Cannot resolve conflict while offline');
      return of(false);
    }

    return this.apiService
      .post<any>('/sync/conflicts/resolve', {
        conflictId: resolution.conflictId,
        entityId: resolution.entityId,
        entityType: resolution.entityType,
        resolution: resolution.resolution,
        mergedData: resolution.mergedData,
      })
      .pipe(
        switchMap((result) => {
          debugLog('✅ Conflict resolved:', result);
          const resolved = result?.data || result?.result || result;
          if (!resolved?.entity || !resolved?.conflictId)
            throw new Error('SYNC_RESOLUTION_MISSING_RESULT');
          return this.offlineStorage
            .finalizeConflictResolution(
              resolution.entityType,
              resolution.entityId,
              resolved.conflictId,
              resolved.entity
            )
            .pipe(
              tap((finalized) => {
                if (!finalized)
                  throw new Error('SYNC_LOCAL_FINALIZATION_FAILED');
                const currentConflicts =
                  this.syncMetadataSubject.value.conflictCount;
                this.updateSyncMetadata({
                  conflictCount: Math.max(0, currentConflicts - 1),
                });
              })
            );
          // Update conflict count
        }),
        map(() => true),
        catchError((error) => {
          console.error('❌ Conflict resolution error:', error);
          return of(false);
        })
      );
  }

  /**
   * الحصول على التعارضات من السيرفر
   */
  getConflicts(): Observable<any[]> {
    if (!this.isOnline) {
      return of([]);
    }

    return this.apiService.get<any[]>('/sync/conflicts').pipe(
      tap((conflicts) => {
        debugLog(`📋 Fetched ${conflicts.length} conflicts`);
        this.updateSyncMetadata({ conflictCount: conflicts.length });
      }),
      catchError((error) => {
        console.error('❌ Error fetching conflicts:', error);
        return of([]);
      })
    );
  }

  // ==================== CONFIGURATION ====================

  updateConfig(config: Partial<SyncConfig>): void {
    this.syncConfig = { ...this.syncConfig, ...config };
    this.syncConfig.syncInterval = [60000, 300000, 900000].includes(
      this.syncConfig.syncInterval
    )
      ? this.syncConfig.syncInterval
      : 300000;
    this.syncConfig.maxRetries = Math.min(
      10,
      Math.max(1, this.syncConfig.maxRetries || 3)
    );
    this.syncConfig.batchSize = Math.min(
      100,
      Math.max(1, this.syncConfig.batchSize || 50)
    );
    localStorage.setItem('sync_config', JSON.stringify(this.syncConfig));
    this.initializeAutoSync();
    debugLog('⚙️ Sync config updated:', this.syncConfig);
  }

  getConfig(): SyncConfig {
    // Try to load from storage if needed, but for now we just return the in-memory one
    // Let's assume it's loaded during initialization.
    return { ...this.syncConfig };
  }

  // ==================== STATUS QUERIES ====================

  isOnlineStatus(): boolean {
    return this.isOnline;
  }

  isSyncInProgress(): boolean {
    return this.syncInProgress;
  }

  getPendingCount(): Observable<number> {
    return this.syncMetadata$.pipe(map((metadata) => metadata.pendingCount));
  }

  getConflictCount(): Observable<number> {
    return this.syncMetadata$.pipe(map((metadata) => metadata.conflictCount));
  }

  // ==================== UTILITY METHODS ====================

  private updateSyncMetadata(updates: Partial<SyncMetadata>): void {
    this.syncMetadataSubject.next({
      ...this.syncMetadataSubject.value,
      ...updates,
    });
  }

  private updateSyncProgress(updates: Partial<SyncProgress>): void {
    this.syncProgressSubject.next({
      ...this.syncProgressSubject.value,
      ...updates,
    });
  }
}
