import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../services/database.service';
import { StoredReceipt } from './receipt.types';

/**
 * Receipt thumbnails live in the device's own database, next to the offline
 * records. They are not synced: a picture of a till slip is private and large.
 * Each is keyed by the transaction's client id (or its id) plus the owner, so
 * one account never sees another's pictures.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptStoreService {
  private readonly db = inject(DatabaseService);

  private key(ownerUserId: string, id: string): string {
    return `${ownerUserId}:${id}`;
  }

  async save(receipt: StoredReceipt): Promise<void> {
    await this.db.receipts.put({
      ...receipt,
      id: this.key(receipt.ownerUserId, receipt.id),
    });
  }

  /** Looks up by any of the ids a transaction may be known by. */
  async find(
    ownerUserId: string,
    ids: Array<string | undefined | null>
  ): Promise<StoredReceipt | undefined> {
    for (const id of ids) {
      if (!id) continue;
      const hit = await this.db.receipts.get(this.key(ownerUserId, id));
      if (hit) return { ...hit, id };
    }
    return undefined;
  }

  async remove(
    ownerUserId: string,
    ids: Array<string | undefined | null>
  ): Promise<void> {
    for (const id of ids) {
      if (id) await this.db.receipts.delete(this.key(ownerUserId, id));
    }
  }

  /** Removes everything this account kept (used when the account is wiped). */
  async clearOwner(ownerUserId: string): Promise<void> {
    await this.db.receipts.where('ownerUserId').equals(ownerUserId).delete();
  }
}
