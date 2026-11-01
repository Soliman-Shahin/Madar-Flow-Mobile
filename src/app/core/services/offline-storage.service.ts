import { Injectable, inject, effect } from '@angular/core';
import {
  SyncEntity,
  SyncStatus,
  OfflineData,
  SyncOperation,
  SyncQueue,
} from 'src/app/shared/models/sync.model';
import { Observable, BehaviorSubject, from, of } from 'rxjs';
import { map, catchError, tap, take } from 'rxjs/operators';
import { DatabaseService } from './database.service';
import { TokenService } from 'src/app/modules/auth/services/token.service';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root',
})
export class OfflineStorageService {
  private db = inject(DatabaseService);
  private tokenService = inject(TokenService);

  private currentOwnerId(): string {
    const ownerId = this.tokenService.getUserId();
    if (!ownerId)
      throw new Error('Authenticated user is required for offline data');
    return String(ownerId);
  }

  private syncQueueSubject = new BehaviorSubject<SyncQueue>({
    operations: [],
    isProcessing: false,
    lastProcessed: new Date(),
    totalProcessed: 0,
    totalErrors: 0,
  });

  public syncQueue$ = this.syncQueueSubject.asObservable();

  constructor() {
    this.loadSyncQueue();
    effect(() => {
      this.tokenService.user();
      void this.loadSyncQueue();
    });
  }

  // ==================== ENTITY MANAGEMENT ====================

  saveEntity<T extends SyncEntity>(
    entityType: string,
    entity: T,
    operationType: 'CREATE' | 'UPDATE' = 'UPDATE'
  ): Observable<T> {
    return from(this.saveEntityAsync(entityType, entity, operationType));
  }

  /** Persist a server-confirmed entity without creating a new sync operation. */
  saveSyncedEntity<T extends SyncEntity>(
    entityType: string,
    entity: T
  ): Observable<T> {
    const ownerUserId = this.currentOwnerId();
    return from(
      (async () => {
        const table = this.db.getTable(entityType);
        const local = entity._clientId
          ? await table
              .where('[_clientId+ownerUserId]')
              .equals([entity._clientId, ownerUserId])
              .first()
          : null;
        await this.db.transaction('rw', table, async () => {
          if (local && local._id !== entity._id) await table.delete(local._id);
          await table.put({
            ...local,
            ...entity,
            ownerUserId,
            _syncStatus: SyncStatus.SYNCED,
            _lastModified: entity._lastModified || new Date(),
            _serverVersion: entity._version,
          });
        });
        return entity;
      })()
    ).pipe(
      map(() => entity),
      catchError((error) => {
        console.error(`Error saving synced ${entityType}:`, error);
        return of(entity);
      })
    );
  }

  private async saveEntityAsync<T extends SyncEntity>(
    entityType: string,
    entity: T,
    operationType: 'CREATE' | 'UPDATE'
  ): Promise<T> {
    const ownerUserId = this.currentOwnerId();
    if (!entity._clientId && String(entity._id).startsWith('offline_'))
      entity = { ...entity, _clientId: entity._id };
    const table = this.db.getTable(entityType);
    const existing = await table.get(entity._id);
    if (existing?.ownerUserId && String(existing.ownerUserId) !== ownerUserId)
      throw new Error('Offline entity belongs to another user');

    let updatedEntity: T;
    if (existing) {
      updatedEntity = {
        ...existing,
        ...entity,
        ownerUserId,
        _lastModified: new Date(),
        _version: (existing._version || 0) + 1,
        _serverVersion: existing._serverVersion ?? existing._version,
      };
    } else {
      updatedEntity = {
        ...entity,
        ownerUserId,
        _lastModified: new Date(),
        _version: 1,
        _serverVersion: undefined,
        _syncStatus: SyncStatus.PENDING,
      };
    }

    try {
      await this.db.transaction(
        'rw',
        table,
        this.db.syncOperations,
        async () => {
          await table.put(updatedEntity);
          await this.addToSyncQueueAsync(
            operationType,
            entityType,
            entity._id,
            updatedEntity
          );
        }
      );
    } catch (error) {
      throw error;
    }
    await this.loadSyncQueue();
    return updatedEntity;
  }

  getEntity<T extends SyncEntity>(
    entityType: string,
    id: string
  ): Observable<T | null> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return of(null);
    return from(this.db.getTable(entityType).get(id)).pipe(
      map((res) =>
        res && String(res.ownerUserId) === String(ownerUserId)
          ? (res as T)
          : null
      )
    );
  }

  getEntities<T extends SyncEntity>(entityType: string): Observable<T[]> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return of([]);
    const table = this.db.getTable(entityType);
    return from(
      table.where('ownerUserId').equals(String(ownerUserId)).toArray()
    ).pipe(
      tap((rows: any[]) => {
        if (entityType.toLowerCase().startsWith('categor')) {
        }
      }),
      map((res) => {
        const seen = new Set<string>();
        return (res as T[]).filter((entity: any) => {
          const key = entity._clientId || entity._id;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })
    );
  }

  getAllEntitiesForBackup<T extends SyncEntity>(
    entityType: string
  ): Observable<T[]> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return of([]);
    if (entityType.toLowerCase() === 'user') {
      const user = this.tokenService.getUser();
      return of(user ? [user as unknown as T] : []);
    }
    return from(
      this.db
        .getTable(entityType)
        .where('ownerUserId')
        .equals(String(ownerUserId))
        .toArray()
    ).pipe(map((res) => res as T[]));
  }

  replaceEntities<T extends SyncEntity>(
    entityType: string,
    entities: T[]
  ): Observable<boolean> {
    const ownerUserId = this.currentOwnerId();
    return from(
      this.db
        .getTable(entityType)
        .bulkPut(entities.map((e) => ({ ...e, ownerUserId })))
    ).pipe(
      map(() => true),
      catchError((error) => {
        console.error(`Error replacing ${entityType} entities:`, error);
        return of(false);
      })
    );
  }

  async hasUnsyncedChanges(): Promise<boolean> {
    const ownerUserId = this.currentOwnerId();
    const operations = await this.db.syncOperations
      .where('ownerUserId')
      .equals(ownerUserId)
      .toArray();
    return operations.some(
      (operation) =>
        operation.status === SyncStatus.PENDING ||
        operation.status === SyncStatus.ERROR
    );
  }

  replaceEntitiesAtomically(
    expenses: any[],
    categories: any[]
  ): Observable<boolean> {
    const ownerUserId = this.currentOwnerId();
    return from(
      this.db.transaction(
        'rw',
        this.db.expenses,
        this.db.categories,
        this.db.syncOperations,
        async () => {
          const [currentExpenses, currentCategories] = await Promise.all([
            this.db.expenses.where('ownerUserId').equals(ownerUserId).toArray(),
            this.db.categories
              .where('ownerUserId')
              .equals(ownerUserId)
              .toArray(),
          ]);
          const logicalMatch = (current: any[], incoming: any) =>
            current.find(
              (row) =>
                (incoming._id && row._id === incoming._id) ||
                (incoming._clientId &&
                  (row._id === incoming._clientId ||
                    row._clientId === incoming._clientId))
            );
          const missing = (incoming: any, current: any[]) =>
            !logicalMatch(current, incoming);
          const restoredExpenses = expenses
            .filter((entity) => missing(entity, currentExpenses))
            .map((entity) => ({
              ...entity,
              ownerUserId,
              _syncStatus: String(entity._id || '').startsWith('offline_')
                ? SyncStatus.PENDING
                : SyncStatus.SYNCED,
            }));
          const restoredCategories = categories
            .filter((entity) => missing(entity, currentCategories))
            .map((entity) => ({
              ...entity,
              ownerUserId,
              _syncStatus: String(entity._id || '').startsWith('offline_')
                ? SyncStatus.PENDING
                : SyncStatus.SYNCED,
            }));
          await this.db.expenses
            .where('ownerUserId')
            .equals(ownerUserId)
            .delete();
          // Reinsert the complete current owner set plus only missing backup
          // rows. Existing rows and durable tombstones always win.
          await this.db.expenses.bulkPut([
            ...currentExpenses,
            ...restoredExpenses,
          ]);
          await this.db.categories.bulkPut([
            ...currentCategories,
            ...restoredCategories,
          ]);
          for (const entity of [...restoredCategories, ...restoredExpenses]) {
            if (entity._syncStatus !== SyncStatus.PENDING) continue;
            const entityType = restoredCategories.includes(entity)
              ? 'category'
              : 'expense';
            await this.addToSyncQueueAsync(
              'CREATE',
              entityType,
              entity._id,
              entity
            );
          }
        }
      )
    ).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  mergeEntities<T extends SyncEntity>(
    entityType: string,
    serverEntities: T[]
  ): Observable<boolean> {
    return from(this.mergeEntitiesAsync(entityType, serverEntities)).pipe(
      catchError((error) => {
        console.error(`Error merging ${entityType} entities:`, error);
        return of(false);
      })
    );
  }

  private async mergeEntitiesAsync<T extends SyncEntity>(
    entityType: string,
    serverEntities: T[]
  ): Promise<boolean> {
    const ownerUserId = this.currentOwnerId();
    const table = this.db.getTable(entityType);
    const localEntities = await table
      .where('ownerUserId')
      .equals(ownerUserId)
      .toArray();

    for (const serverEntity of serverEntities) {
      // Find local entity by _id OR by _clientId
      const matchingRows = localEntities.filter(
        (e: any) =>
          e._id === serverEntity._id ||
          (serverEntity._clientId &&
            (e._id === serverEntity._clientId ||
              e._clientId === serverEntity._clientId))
      );
      const localEntity = matchingRows[0];

      if (serverEntity._isDeleted) {
        if (localEntity) {
          // Keep a durable tombstone so stale pull/cache data cannot resurrect it.
          await table.put({
            ...localEntity,
            _isDeleted: true,
            _syncStatus: SyncStatus.SYNCED,
            ownerUserId,
          });
        }
        continue;
      }

      if (localEntity) {
        // If we found it by _clientId (i.e. the local item is an offline item),
        // we MUST delete the old offline ID record because its primary key will change.
        for (const row of matchingRows) {
          if (row._id !== serverEntity._id) await table.delete(row._id);
        }

        const serverTime = new Date(serverEntity._lastModified).getTime();
        const localTime = new Date(localEntity._lastModified).getTime();

        // Overwrite if server is newer, OR if the ID changed (we always want the real ID)
        if (serverTime >= localTime || localEntity._id !== serverEntity._id) {
          await table.put({
            ...serverEntity,
            _serverVersion: serverEntity._version,
            ownerUserId,
            _syncStatus: SyncStatus.SYNCED,
          });
        }
      } else {
        await table.put({
          ...serverEntity,
          _serverVersion: serverEntity._version,
          ownerUserId,
          _syncStatus: SyncStatus.SYNCED,
        });
      }
      if (
        serverEntity._clientId ||
        String(serverEntity._id || '').startsWith('offline_')
      ) {
        const afterPull = await table
          .where('ownerUserId')
          .equals(ownerUserId)
          .toArray();
        const pullRows = afterPull.filter(
          (row: any) =>
            row._clientId === serverEntity._clientId ||
            row._id === serverEntity._id
        );
      }
    }
    return true;
  }

  deleteEntity(entityType: string, id: string): Observable<boolean> {
    return from(this.deleteEntityAsync(entityType, id)).pipe(
      catchError((error) => {
        console.error(`Error deleting ${entityType}:`, error);
        return of(false);
      })
    );
  }

  private async deleteEntityAsync(
    entityType: string,
    id: string
  ): Promise<boolean> {
    const table = this.db.getTable(entityType);
    const entity = await table.get(id);

    if (entity && String(entity.ownerUserId) === this.currentOwnerId()) {
      entity._isDeleted = true;
      entity._lastModified = new Date();
      entity._syncStatus = SyncStatus.PENDING;
      await table.put(entity);
      await this.addToSyncQueueAsync('DELETE', entityType, id, entity);
      await this.loadSyncQueue();
      return true;
    }
    return false;
  }

  removeEntityHard(entityType: string, id: string): void {
    this.db.getTable(entityType).delete(id).catch(console.error);
  }

  // ==================== SYNC QUEUE MANAGEMENT ====================

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
  }

  addToSyncQueue(
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    entityType: string,
    entityId: string,
    data: any
  ): void {
    this.addToSyncQueueAsync(type, entityType, entityId, data)
      .catch(console.error)
      .finally(() => this.loadSyncQueue());
  }

  private async addToSyncQueueAsync(
    type: 'CREATE' | 'UPDATE' | 'DELETE',
    entityType: string,
    entityId: string,
    data: any
  ): Promise<void> {
    const ownerUserId = this.currentOwnerId();
    if (type === 'UPDATE') {
      const existing = await this.db.syncOperations
        .where('ownerUserId')
        .equals(ownerUserId)
        .filter(
          (operation) =>
            operation.entityType === entityType &&
            operation.entityId === entityId &&
            operation.status === SyncStatus.PENDING
        )
        .first();
      if (existing) {
        await this.db.syncOperations.update(existing.id, {
          data,
          timestamp: new Date(),
          baseServerVersion: existing.baseServerVersion ?? data._serverVersion,
          receiptId: undefined,
        });
        return;
      }
    }
    const operation: SyncOperation = {
      id: this.generateId(),
      type,
      entityType: entityType as any,
      entityId,
      data,
      timestamp: new Date(),
      retryCount: 0,
      maxRetries: 3,
      status: SyncStatus.PENDING,
      ownerUserId,
      baseServerVersion: type === 'CREATE' ? undefined : data._serverVersion,
    };

    await this.db.syncOperations.put(operation);
  }

  removeFromSyncQueue(operationId: string): void {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return;
    this.db.syncOperations
      .where('[ownerUserId+status]')
      .anyOf([
        [String(ownerUserId), SyncStatus.PENDING],
        [String(ownerUserId), SyncStatus.ERROR],
      ])
      .filter((op) => op.id === operationId)
      .delete()
      .then(() => this.loadSyncQueue())
      .catch(console.error);
  }

  markSynced(
    entityType: string,
    entityId: string,
    serverVersion: number
  ): void {
    const ownerUserId = this.currentOwnerId();
    if (!ownerUserId) return;
    void this.db.getTable(entityType).update(entityId, {
      _serverVersion: serverVersion,
      _version: serverVersion,
      _syncStatus: SyncStatus.SYNCED,
      ownerUserId,
    });
  }

  markConflict(entityType: string, entityId: string): void {
    const ownerUserId = this.currentOwnerId();
    if (!ownerUserId) return;
    void this.db.getTable(entityType).update(entityId, {
      _syncStatus: SyncStatus.CONFLICT,
      ownerUserId,
    });
  }

  blockSyncOperation(operationId: string, conflictId: string): void {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return;
    void this.db.syncOperations
      .where('ownerUserId')
      .equals(String(ownerUserId))
      .filter((op) => op.id === operationId)
      .modify({ status: SyncStatus.CONFLICT, conflictId })
      .then(() => this.loadSyncQueue());
  }

  finalizeConflictResolution(
    entityType: string,
    entityId: string,
    conflictId: string,
    entity: any
  ): Observable<boolean> {
    const ownerUserId = this.currentOwnerId();
    const table = this.db.getTable(entityType);
    return from(
      (async () => {
        const finalized = await this.db.transaction(
          'rw',
          table,
          this.db.syncOperations,
          async () => {
        const local = await table.get(entityId);
        if (local && String(local.ownerUserId) !== ownerUserId)
          throw new Error('Offline entity belongs to another user');
        await table.put({
          ...local,
          ...entity,
          _id: entityId,
          ownerUserId,
          _syncStatus: SyncStatus.SYNCED,
          _serverVersion: entity._version,
        });
        await this.db.syncOperations
          .where('ownerUserId')
          .equals(ownerUserId)
          .filter(
            (op) => op.entityId === entityId && op.conflictId === conflictId
          )
          .delete();
        return true;
          }
        );
        await this.loadSyncQueue();
        return finalized;
      })()
    ).pipe(
      catchError((error) => {
        console.error('Error finalizing conflict resolution:', error);
        return of(false);
      })
    );
  }

  updateSyncOperation(
    operationId: string,
    updates: Partial<SyncOperation>
  ): void {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return;
    this.db.syncOperations
      .where('ownerUserId')
      .equals(String(ownerUserId))
      .filter((op) => op.id === operationId)
      .modify(updates)
      .then(() => this.loadSyncQueue())
      .catch(console.error);
  }

  async recordSyncFailure(
    operationId: string,
    safeError = 'SYNC_OPERATION_FAILED'
  ): Promise<SyncOperation | null> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return null;
    const operation = await this.db.syncOperations
      .where('ownerUserId')
      .equals(String(ownerUserId))
      .filter((op) => op.id === operationId)
      .first();
    if (!operation) return null;
    if (operation.status !== SyncStatus.PENDING) return operation;

    const retryCount = Math.max(0, Number(operation.retryCount || 0)) + 1;
    const maxRetries = Math.max(1, Number(operation.maxRetries || 3));
    const status =
      retryCount >= maxRetries ? SyncStatus.ERROR : SyncStatus.PENDING;
    const error =
      safeError === 'SYNC_OPERATION_FAILED'
        ? safeError
        : 'SYNC_OPERATION_FAILED';
    await this.db.syncOperations.update(operation.id, {
      retryCount,
      maxRetries,
      status,
      error,
    });
    await this.loadSyncQueue();
    return { ...operation, retryCount, maxRetries, status, error };
  }

  async persistSyncReceipt(operationId: string, receiptId: string): Promise<void> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId || !receiptId) return;
    const operation = await this.db.syncOperations
      .where('ownerUserId').equals(String(ownerUserId))
      .filter((op) => op.id === operationId).first();
    if (operation) await this.db.syncOperations.update(operation.id, { receiptId });
  }

  getPendingOperations(): Observable<SyncOperation[]> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return of([]);
    return this.syncQueue$.pipe(
      take(1),
      map((queue) =>
        queue.operations.filter(
          (op) =>
            op.ownerUserId === String(ownerUserId) &&
            op.status === SyncStatus.PENDING
        )
      )
    );
  }

  reconcileServerId(
    entityType: string,
    localId: string,
    serverId: string
  ): Observable<boolean> {
    return from(
      (async () => {
        const ownerUserId = this.currentOwnerId();
        const table = this.db.getTable(entityType);
        const localRows = await table
          .where('ownerUserId')
          .equals(ownerUserId)
          .toArray();
        const local = localRows.find(
          (row: any) => row._id === localId || row._clientId === localId
        );
        const logicalId = local?._clientId || localId;
        const matchingRows = localRows.filter(
          (row: any) =>
            row._clientId === logicalId ||
            row._id === logicalId ||
            row._id === serverId
        );
        if (!local && matchingRows.length === 0) return false;
        await this.db.transaction('rw', table, async () => {
          for (const row of matchingRows) {
            if (row._id !== serverId) {
              await table.delete(row._id);
            }
          }
          const authoritative =
            matchingRows.find((row: any) => row._id === serverId) || local;
          await table.put({
            ...authoritative,
            _id: serverId,
            _clientId: logicalId,
            ownerUserId,
            _syncStatus: SyncStatus.SYNCED,
          });
        });
        const after = await table
          .where('ownerUserId')
          .equals(ownerUserId)
          .toArray();
        const rows = after.filter(
          (row: any) =>
            row._clientId === logicalId ||
            row._id === logicalId ||
            row._id === serverId
        );
        return true;
      })()
    );
  }

  private async loadSyncQueue() {
    try {
      const ownerUserId = this.tokenService.getUserId();
      const ops = ownerUserId
        ? await this.db.syncOperations
            .where('ownerUserId')
            .equals(String(ownerUserId))
            .toArray()
        : [];
      const currentQueue = this.syncQueueSubject.value;
      this.syncQueueSubject.next({
        ...currentQueue,
        operations: ops,
      });
    } catch (error) {
      console.error('Error loading sync queue:', error);
    }
  }

  // ==================== BACKUP & RESTORE ====================

  createBackup(): Observable<OfflineData> {
    const ownerUserId = this.currentOwnerId();
    return from(
      Promise.all([
        this.db.expenses.where('ownerUserId').equals(ownerUserId).toArray(),
        this.db.categories.where('ownerUserId').equals(ownerUserId).toArray(),
        this.db.users.where('_id').equals(ownerUserId).toArray(),
      ])
    ).pipe(
      map(([expenses, categories, users]) => {
        return {
          expenses,
          categories,
          user: users[0] || null,
          lastBackup: new Date(),
          version: '1.0.0',
        };
      })
    );
  }

  restoreBackup(backup: OfflineData): Observable<boolean> {
    const ownerUserId = this.currentOwnerId();
    const expenses = backup.expenses.map((e) => ({ ...e, ownerUserId }));
    const categories = backup.categories.map((c) => ({ ...c, ownerUserId }));
    return from(
      this.db.transaction(
        'rw',
        this.db.expenses,
        this.db.categories,
        async () => {
          await this.db.expenses
            .where('ownerUserId')
            .equals(ownerUserId)
            .delete();
          await this.db.categories
            .where('ownerUserId')
            .equals(ownerUserId)
            .delete();
          await this.db.expenses.bulkPut(expenses);
          await this.db.categories.bulkPut(categories);
        }
      )
    ).pipe(
      map(() => true),
      catchError((error) => {
        console.error('Error restoring backup:', error);
        return of(false);
      })
    );
  }

  // ==================== CLEANUP ====================

  clearOfflineData(): Observable<boolean> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return of(false);
    return from(
      Promise.all([
        this.db.expenses
          .where('ownerUserId')
          .equals(String(ownerUserId))
          .delete(),
        this.db.categories
          .where('ownerUserId')
          .equals(String(ownerUserId))
          .delete(),
        this.db.syncOperations
          .where('ownerUserId')
          .equals(String(ownerUserId))
          .delete(),
      ])
    ).pipe(
      tap(() => this.loadSyncQueue()),
      map(() => {
        this.syncQueueSubject.next({
          operations: [],
          isProcessing: false,
          lastProcessed: new Date(),
          totalProcessed: 0,
          totalErrors: 0,
        });
        return true;
      }),
      catchError((error) => {
        console.error('Error clearing offline data:', error);
        return of(false);
      })
    );
  }

  getStorageSize(): Observable<number> {
    const ownerUserId = this.tokenService.getUserId();
    if (!ownerUserId) return of(0);
    return from(
      Promise.all([
        this.db.expenses
          .where('ownerUserId')
          .equals(String(ownerUserId))
          .count(),
        this.db.categories
          .where('ownerUserId')
          .equals(String(ownerUserId))
          .count(),
        this.db.syncOperations
          .where('ownerUserId')
          .equals(String(ownerUserId))
          .count(),
      ])
    ).pipe(map(([expenses, categories, ops]) => expenses + categories + ops));
  }
}
