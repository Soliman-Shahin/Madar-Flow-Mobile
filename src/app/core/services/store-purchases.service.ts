import { Injectable, inject } from '@angular/core';
import { MyPlanResponse, Plan } from '../../shared/models/plan.model';
import { TokenService } from '../../modules/auth/services/token.service';
import { PlanService } from './plan.service';
import { StorePackage, StorePurchasesGateway } from './store-purchases.gateway';
import { debugLog } from '../../shared/utils/debug-log.util';
import { invalidateHttpCache } from '../interceptors/cache.interceptor';

export type PurchaseOutcome = 'active' | 'pending' | 'cancelled' | 'failed';
export type RestoreOutcome = 'restored' | 'nothing' | 'failed';

/** Part of a store product id before the base-plan suffix (`pro:monthly` → `pro`). */
export function baseProductId(productId: string): string {
  return productId.split(':')[0];
}

/**
 * In-app subscriptions through RevenueCat.
 *
 * The store charges the user and RevenueCat tells the backend; the backend is
 * the only thing that grants a plan. This service therefore never decides that
 * a purchase "worked" by itself: after a purchase it waits for the server's
 * `/plans/me` to show the new plan, and reports `pending` if that takes long.
 */
@Injectable({ providedIn: 'root' })
export class StorePurchasesService {
  private readonly gateway = inject(StorePurchasesGateway);
  private readonly planService = inject(PlanService);
  private readonly tokenService = inject(TokenService);

  /** User the SDK is currently identified as (never anonymous). */
  private configuredFor: string | null = null;

  /** Wait between server checks after a purchase; tests set this to 0. */
  pollDelayMs = 2500;
  pollAttempts = 8;

  constructor() {
    this.tokenService.sessionEnded$.subscribe(() => void this.reset());
  }

  /** True when this device can buy and the server has billing configured. */
  isAvailable(my: MyPlanResponse | null | undefined): boolean {
    return this.gateway.supported && !!my?.billing?.androidPublicKey;
  }

  /** Store offers for the signed-in user, or [] when they cannot be loaded. */
  async loadPackages(my: MyPlanResponse): Promise<StorePackage[]> {
    try {
      if (!(await this.identify(my))) return [];
      return await this.gateway.packages();
    } catch (error) {
      debugLog('Store offers unavailable', error);
      return [];
    }
  }

  /** Offers that belong to one plan, matched by the product ids set in the dashboard. */
  packagesFor(plan: Plan, all: StorePackage[]): StorePackage[] {
    const ids = (plan.productIds ?? []).map(baseProductId);
    return all.filter((p) => ids.includes(baseProductId(p.productId)));
  }

  /** `expectedSlug` is the plan this offer grants; the purchase is confirmed when the server shows it. */
  async purchase(
    my: MyPlanResponse,
    pkg: StorePackage,
    expectedSlug?: string
  ): Promise<PurchaseOutcome> {
    try {
      if (!(await this.identify(my))) return 'failed';
      await this.gateway.purchase(pkg);
    } catch (error) {
      if (this.gateway.isCancelled(error)) return 'cancelled';
      debugLog('Purchase failed', error);
      return 'failed';
    }
    return (await this.waitForPlan(expectedSlug)) ? 'active' : 'pending';
  }

  /** "Restore purchases": re-link store purchases, then let the server confirm. */
  async restore(my: MyPlanResponse): Promise<RestoreOutcome> {
    try {
      if (!(await this.identify(my))) return 'failed';
      await this.gateway.restore();
      await this.planService.syncPurchases();
    } catch (error) {
      debugLog('Restore failed', error);
      return 'failed';
    }
    invalidateHttpCache('/plans/me');
    const refreshed = await this.planService.getMyPlan().catch(() => null);
    return refreshed && refreshed.context.planSlug !== 'free'
      ? 'restored'
      : 'nothing';
  }

  /** Make the SDK act for the signed-in account; false if that is impossible. */
  private async identify(my: MyPlanResponse): Promise<boolean> {
    const key = my.billing?.androidPublicKey;
    const userId = this.tokenService.getUserId();
    if (!this.gateway.supported || !key || !userId) return false;
    if (this.configuredFor === userId) return true;
    if (this.configuredFor === null) {
      await this.gateway.configure(key, userId);
    } else {
      await this.gateway.logIn(userId);
    }
    this.configuredFor = userId;
    return true;
  }

  private async reset(): Promise<void> {
    if (this.configuredFor === null) return;
    this.configuredFor = null;
    try {
      await this.gateway.logOut();
    } catch {
      // Already anonymous or not configured: nothing to undo.
    }
  }

  /** The webhook can lag a few seconds; poll, and ask the server to re-check once. */
  private async waitForPlan(expectedSlug?: string): Promise<boolean> {
    let synced = false;
    for (let i = 0; i < this.pollAttempts; i++) {
      invalidateHttpCache('/plans/me');
      const my = await this.planService.getMyPlan().catch(() => null);
      const slug = my?.context.planSlug;
      if (slug && (expectedSlug ? slug === expectedSlug : slug !== 'free')) {
        return true;
      }
      if (!synced && i >= 2) {
        synced = true;
        await this.planService.syncPurchases().catch(() => undefined);
      }
      if (this.pollDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.pollDelayMs));
      }
    }
    return false;
  }
}
