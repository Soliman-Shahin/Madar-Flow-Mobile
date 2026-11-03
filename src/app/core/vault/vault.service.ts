import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';
import { ConnectionService } from '../services/connection.service';
import { DatabaseService } from '../services/database.service';
import { TokenService } from 'src/app/modules/auth/services';
import { GoldPriceOverride } from './vault-valuation';
import { MarketPrices, VaultAsset } from './vault.types';

const PRICES_KEY = 'madarflow_vault_prices';
const OVERRIDE_KEY = 'madarflow_vault_gold_override';
const PRICE_MAX_AGE_MS = 15 * 60 * 1000;

interface ServerAsset {
  clientId: string;
  type: VaultAsset['type'];
  name: string;
  status: 'held' | 'sold';
  purchasedAt: string;
  cost: { amount: number; currency: string };
  details: VaultAsset['details'];
  note: string | null;
  soldAt: string | null;
  saleAmount: number | null;
  isDeleted: boolean;
  updatedAt: string;
}

export interface VaultUsage {
  used: number;
  /** null = unlimited */
  limit: number | null;
}

/**
 * The vault on this phone. Everything is written here first (so it works
 * offline) and pushed to the account when there is a connection. The copy with
 * the newer edit time wins when the same item changed in two places.
 */
@Injectable({ providedIn: 'root' })
export class VaultService {
  private readonly db = inject(DatabaseService);
  private readonly api = inject(ApiService);
  private readonly connection = inject(ConnectionService);
  private readonly token = inject(TokenService);

  private readonly assetsSubject = new BehaviorSubject<VaultAsset[]>([]);
  readonly assets$ = this.assetsSubject.asObservable();
  private readonly pricesSubject = new BehaviorSubject<MarketPrices | null>(this.readCachedPrices());
  readonly prices$ = this.pricesSubject.asObservable();
  private readonly usageSubject = new BehaviorSubject<VaultUsage | null>(null);
  readonly usage$ = this.usageSubject.asObservable();

  private syncing = false;

  private owner(): string | null {
    const id = this.token.getUserId();
    return id ? String(id) : null;
  }

  /** Items that are not deleted, newest first. */
  get assets(): VaultAsset[] {
    return this.assetsSubject.value;
  }

  get prices(): MarketPrices | null {
    return this.pricesSubject.value;
  }

  get usage(): VaultUsage | null {
    return this.usageSubject.value;
  }

  // ---- local store -----------------------------------------------------

  async load(): Promise<VaultAsset[]> {
    const owner = this.owner();
    if (!owner) {
      this.assetsSubject.next([]);
      return [];
    }
    const rows = await this.db.assets.where('ownerUserId').equals(owner).toArray();
    const live = rows
      .filter((a) => !a.deleted)
      .sort((x, y) => y.purchasedAt.localeCompare(x.purchasedAt));
    this.assetsSubject.next(live);
    return live;
  }

  async get(id: string): Promise<VaultAsset | undefined> {
    const owner = this.owner();
    const a = await this.db.assets.get(id);
    return a && a.ownerUserId === owner && !a.deleted ? a : undefined;
  }

  /** Saves an item (new or edited) on the phone and queues it for the account. */
  async save(
    input: Omit<VaultAsset, 'id' | 'ownerUserId' | 'updatedAt' | 'synced'> & { id?: string }
  ): Promise<VaultAsset> {
    const owner = this.owner();
    if (!owner) throw new Error('Authenticated user is required');
    const asset: VaultAsset = {
      ...input,
      id: input.id ?? newId(),
      ownerUserId: owner,
      updatedAt: new Date().toISOString(),
      synced: 0,
    };
    await this.db.assets.put(asset);
    await this.load();
    void this.sync();
    return asset;
  }

  async remove(id: string): Promise<void> {
    const a = await this.get(id);
    if (!a) return;
    await this.db.assets.put({
      ...a,
      deleted: true,
      updatedAt: new Date().toISOString(),
      synced: 0,
    });
    await this.load();
    void this.sync();
  }

  // ---- account sync ----------------------------------------------------

  /** Pushes unsynced changes, then pulls what the account has. Safe to call often. */
  async sync(): Promise<void> {
    const owner = this.owner();
    if (!owner || this.syncing || !this.connection.isOnline()) return;
    this.syncing = true;
    try {
      const pending = await this.db.assets
        .where('[ownerUserId+synced]')
        .equals([owner, 0])
        .toArray();
      for (const a of pending) {
        try {
          if (a.deleted) {
            await firstValueFrom(this.api.delete(`/vault/assets/${a.id}`));
            await this.db.assets.delete(a.id);
          } else {
            const saved = await firstValueFrom(
              this.api.put<ServerAsset>(`/vault/assets/${a.id}`, toServer(a))
            );
            // the account may hold a newer copy of the same item
            const fromServer = fromServerAsset(saved, owner);
            if (fromServer.updatedAt > a.updatedAt) await this.db.assets.put(fromServer);
            else await this.db.assets.update(a.id, { synced: 1 });
          }
        } catch (e) {
          if (isPlanLimit(e)) {
            // the account's allowance was reached on another device: keep it
            // on this phone, but stop retrying it
            await this.db.assets.update(a.id, { synced: 1 });
          }
          // other failures: leave it queued for the next attempt
        }
      }
      const remote = await firstValueFrom(this.api.get<ServerAsset[]>('/vault/assets'));
      for (const r of remote ?? []) {
        const local = await this.db.assets.get(r.clientId);
        if (local && local.ownerUserId !== owner) continue;
        if (local && local.synced === 0 && local.updatedAt >= r.updatedAt) continue;
        if (local && local.updatedAt >= r.updatedAt && local.synced === 1) continue;
        if (r.isDeleted) {
          if (local) await this.db.assets.delete(r.clientId);
          continue;
        }
        await this.db.assets.put(fromServerAsset(r, owner));
      }
      await this.refreshUsage();
    } catch {
      /* offline or server trouble: the phone copy is complete on its own */
    } finally {
      this.syncing = false;
      await this.load();
    }
  }

  async refreshUsage(): Promise<void> {
    try {
      this.usageSubject.next(await firstValueFrom(this.api.get<VaultUsage>('/vault/usage')));
    } catch {
      /* keep the last known value */
    }
  }

  /** Removes everything this account kept on the phone (used when the account is wiped). */
  async clearOwner(ownerUserId: string): Promise<void> {
    await this.db.assets.where('ownerUserId').equals(ownerUserId).delete();
    this.assetsSubject.next([]);
  }

  // ---- prices ----------------------------------------------------------

  /** Latest prices: the cache while fresh, otherwise the server; the old copy if offline. */
  async refreshPrices(force = false): Promise<MarketPrices | null> {
    const cached = this.pricesSubject.value;
    const age = cached ? Date.now() - new Date(cached.updatedAt).getTime() : Infinity;
    if (!force && cached && age < PRICE_MAX_AGE_MS) return cached;
    if (!this.connection.isOnline()) return cached;
    try {
      const fresh = await firstValueFrom(this.api.get<MarketPrices>('/vault/prices'));
      if (fresh?.usdPer && fresh.goldUsdPerGram24 > 0) {
        this.pricesSubject.next(fresh);
        try {
          localStorage.setItem(PRICES_KEY, JSON.stringify(fresh));
        } catch {
          /* storage unavailable */
        }
        return fresh;
      }
    } catch {
      /* keep what we have */
    }
    return cached;
  }

  private readCachedPrices(): MarketPrices | null {
    try {
      const raw = localStorage.getItem(PRICES_KEY);
      return raw ? (JSON.parse(raw) as MarketPrices) : null;
    } catch {
      return null;
    }
  }

  // ---- the person's own gold price --------------------------------------

  get goldOverride(): GoldPriceOverride | null {
    try {
      const raw = localStorage.getItem(OVERRIDE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v && v.perGram24 > 0 && typeof v.currency === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  set goldOverride(value: GoldPriceOverride | null) {
    try {
      if (value) localStorage.setItem(OVERRIDE_KEY, JSON.stringify(value));
      else localStorage.removeItem(OVERRIDE_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function isPlanLimit(e: unknown): boolean {
  const x = e as { code?: string; error?: { code?: string }; message?: string };
  return (
    x?.code === 'PLAN_LIMIT_EXCEEDED' ||
    x?.error?.code === 'PLAN_LIMIT_EXCEEDED' ||
    /plan limit/i.test(x?.message ?? '')
  );
}

function toServer(a: VaultAsset) {
  return {
    type: a.type,
    name: a.name,
    status: a.status,
    purchasedAt: a.purchasedAt,
    cost: a.cost,
    details: a.details,
    note: a.note || undefined,
    soldAt: a.soldAt || undefined,
    saleAmount: a.saleAmount,
    updatedAt: a.updatedAt,
  };
}

function fromServerAsset(r: ServerAsset, ownerUserId: string): VaultAsset {
  return {
    id: r.clientId,
    ownerUserId,
    type: r.type,
    name: r.name,
    status: r.status,
    purchasedAt: r.purchasedAt,
    cost: r.cost,
    details: r.details,
    note: r.note ?? undefined,
    soldAt: r.soldAt ?? undefined,
    saleAmount: r.saleAmount ?? undefined,
    updatedAt: r.updatedAt,
    synced: 1,
  };
}
