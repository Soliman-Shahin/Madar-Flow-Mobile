import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Purchases, PurchasesPackage } from '@revenuecat/purchases-capacitor';

/** A store subscription offer, already reduced to what the UI needs. */
export interface StorePackage {
  /** RevenueCat package id (for example `$rc_monthly`). */
  id: string;
  /** Store product id (Google Play: `subscriptionId:basePlanId`). */
  productId: string;
  /** Price exactly as the store shows it, in the user's currency. */
  priceString: string;
  cycle: 'monthly' | 'yearly' | 'other';
  /** Opaque SDK object, only used to start the purchase. */
  native: PurchasesPackage;
}

/**
 * Thin wrapper over the RevenueCat SDK. It exists so the rest of the app (and
 * its tests) never touch the native plugin directly, and so iOS can be added
 * here later without changing callers.
 */
@Injectable({ providedIn: 'root' })
export class StorePurchasesGateway {
  /** In-app purchases are wired for Android only for now. */
  get supported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  async configure(apiKey: string, userId: string): Promise<void> {
    await Purchases.configure({ apiKey, appUserID: userId });
  }

  async logIn(userId: string): Promise<void> {
    await Purchases.logIn({ appUserID: userId });
  }

  async logOut(): Promise<void> {
    await Purchases.logOut();
  }

  async packages(): Promise<StorePackage[]> {
    const offerings = await Purchases.getOfferings();
    const list = offerings.current?.availablePackages ?? [];
    return list.map((p) => ({
      id: p.identifier,
      productId: p.product.identifier,
      priceString: p.product.priceString,
      cycle:
        p.packageType === 'MONTHLY'
          ? 'monthly'
          : p.packageType === 'ANNUAL'
            ? 'yearly'
            : 'other',
      native: p,
    }));
  }

  async purchase(pkg: StorePackage): Promise<void> {
    await Purchases.purchasePackage({ aPackage: pkg.native });
  }

  async restore(): Promise<void> {
    await Purchases.restorePurchases();
  }

  /** True when the user closed the store sheet themselves (not an error). */
  isCancelled(error: unknown): boolean {
    const e = error as { userCancelled?: boolean; code?: string | number };
    return e?.userCancelled === true || String(e?.code) === '1';
  }
}
