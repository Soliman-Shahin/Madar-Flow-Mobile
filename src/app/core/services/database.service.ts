import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { SyncOperation } from 'src/app/shared/models/sync.model';
import { StoredReceipt } from 'src/app/core/receipts/receipt.types';

@Injectable({
  providedIn: 'root',
})
export class DatabaseService extends Dexie {
  // Define tables
  expenses!: Table<any, string>;
  categories!: Table<any, string>;
  users!: Table<any, string>;
  syncOperations!: Table<SyncOperation, string>;
  /** Receipt pictures and details, kept on this device only. */
  receipts!: Table<StoredReceipt, string>;

  constructor() {
    super('MadarFlowDB');

    // Define database schema
    this.version(1).stores({
      expenses: '_id, _syncStatus, _lastModified, category, user, _isDeleted',
      categories: '_id, _syncStatus, _lastModified, type, user, _isDeleted',
      users: '_id, _syncStatus, _lastModified',
      syncOperations: 'id, entityType, timestamp, status',
    });
    this.version(2).stores({
      expenses:
        '_id, ownerUserId, [_clientId+ownerUserId], [ownerUserId+_syncStatus], _syncStatus, _lastModified, category, user, _isDeleted',
      categories:
        '_id, ownerUserId, [_clientId+ownerUserId], [ownerUserId+_syncStatus], _syncStatus, _lastModified, type, user, _isDeleted',
      users: '_id, _syncStatus, _lastModified',
      syncOperations:
        'id, ownerUserId, [ownerUserId+status], entityType, timestamp, status',
    });
    // Additive: a table for receipt thumbnails. Existing tables are untouched.
    this.version(3).stores({
      receipts: 'id, ownerUserId',
    });
  }

  /**
   * Helper to get table dynamically by name
   */
  getTable(entityType: string): Table<any, string> {
    switch (entityType.toLowerCase()) {
      case 'expense':
      case 'expenses':
        return this.expenses;
      case 'category':
      case 'categories':
        return this.categories;
      case 'user':
      case 'users':
        return this.users;
      default:
        throw new Error(`Table for entity type ${entityType} not found`);
    }
  }
}
