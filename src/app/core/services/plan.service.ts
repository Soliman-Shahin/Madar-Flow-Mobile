import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  PlanSlug,
  Permission,
  PlanLimits,
  Plan,
  UserPlanContext,
  UsageStats,
  MyPlanResponse,
} from '../../shared/models/plan.model';
import { TokenService } from '../../modules/auth/services/token.service';
import { invalidateHttpCache } from '../interceptors/cache.interceptor';

/**
 * Plan Service
 *
 * Manages user subscription plans, permissions, and usage limits.
 * Provides helper methods for checking plan features and limits.
 */

@Injectable({
  providedIn: 'root',
})
export class PlanService {
  private http = inject(HttpClient);
  private apiUrl = Capacitor.isNativePlatform()
    ? environment.nativeApiUrl
    : environment.browserApiUrl;

  // State management
  private currentPlanSubject = new BehaviorSubject<MyPlanResponse | null>(null);
  public currentPlan$ = this.currentPlanSubject.asObservable();

  private availablePlansSubject = new BehaviorSubject<Plan[]>([]);
  public availablePlans$ = this.availablePlansSubject.asObservable();
  private accountRevision = 0;

  constructor(private tokenService: TokenService) {
    this.tokenService.sessionEnded$.subscribe(() => {
      this.accountRevision++;
      this.clearPlanCache();
    });
  }

  // ==================== Public API ====================

  /**
   * Fetches all available plans for display in the upgrade screen
   */
  async getAvailablePlans(): Promise<Plan[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: Plan[] }>(`${this.apiUrl}/plans`)
      );
      this.availablePlansSubject.next(response.data);
      return response.data;
    } catch (error) {
      console.error('Error fetching available plans:', error);
      throw error;
    }
  }

  /**
   * Fetches the current user's plan, permissions, limits, and usage
   */
  async getMyPlan(): Promise<MyPlanResponse> {
    const revision = this.accountRevision;
    const userId = this.tokenService.getUserId();
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: MyPlanResponse }>(`${this.apiUrl}/plans/me`)
      );
      if (
        revision === this.accountRevision &&
        userId === this.tokenService.getUserId()
      ) {
        this.currentPlanSubject.next(response.data);
      }
      return response.data;
    } catch (error) {
      console.error('Error fetching my plan:', error);
      throw error;
    }
  }

  /**
   * Upgrades the user's plan
   */
  async upgradePlan(planSlug: PlanSlug, paymentRef?: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ data: any }>(`${this.apiUrl}/plans/upgrade`, {
          planSlug,
          paymentRef,
        })
      );
      // Refresh current plan after upgrade
      invalidateHttpCache('/plans/me');
      await this.getMyPlan();
      return response.data;
    } catch (error) {
      console.error('Error upgrading plan:', error);
      throw error;
    }
  }

  /**
   * Asks the server to re-check the user's store purchases with RevenueCat
   * ("restore purchases"). It can only grant a plan, never remove one.
   */
  async syncPurchases(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.apiUrl}/billing/sync`, {}));
    invalidateHttpCache('/plans/me');
  }

  // ==================== Permission Checks ====================

  /**
   * Checks if the user has a specific permission
   */
  hasPermission(permission: Permission): boolean {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return false;
    return currentPlan.context.permissions.includes(permission);
  }

  /**
   * Checks if the user has any of the specified permissions
   */
  hasAnyPermission(permissions: Permission[]): boolean {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return false;
    return permissions.some((p) => currentPlan.context.permissions.includes(p));
  }

  /**
   * Checks if the user has all of the specified permissions
   */
  hasAllPermissions(permissions: Permission[]): boolean {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return false;
    return permissions.every((p) =>
      currentPlan.context.permissions.includes(p)
    );
  }

  // ==================== Limit Checks ====================

  /**
   * Checks if the user can add a new category
   */
  canAddCategory(): boolean {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return false;

    const { limits } = currentPlan.context;
    const { categories } = currentPlan.usage;

    // null = unlimited
    if (limits.maxCategories === null) return true;

    return categories.used < limits.maxCategories;
  }

  /**
   * Checks if the user can add a new transaction
   */
  canAddTransaction(): boolean {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return false;

    const { limits } = currentPlan.context;
    const { transactionsThisMonth } = currentPlan.usage;

    // null = unlimited
    if (limits.maxTransactionsPerMonth === null) return true;

    return transactionsThisMonth.used < limits.maxTransactionsPerMonth;
  }

  /**
   * Returns the remaining categories the user can create
   */
  getRemainingCategories(): number | null {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return 0;

    const { limits } = currentPlan.context;
    const { categories } = currentPlan.usage;

    if (limits.maxCategories === null) return null; // unlimited

    return Math.max(0, limits.maxCategories - categories.used);
  }

  /**
   * Returns the remaining transactions the user can create this month
   */
  getRemainingTransactions(): number | null {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return 0;

    const { limits } = currentPlan.context;
    const { transactionsThisMonth } = currentPlan.usage;

    if (limits.maxTransactionsPerMonth === null) return null; // unlimited

    return Math.max(
      0,
      limits.maxTransactionsPerMonth - transactionsThisMonth.used
    );
  }

  // ==================== Plan Comparison ====================

  /**
   * Checks if the user is on a specific plan
   */
  isOnPlan(planSlug: PlanSlug): boolean {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return false;
    return currentPlan.context.planSlug === planSlug;
  }

  /**
   * Checks if the user is on the Free plan
   */
  isFreePlan(): boolean {
    return this.isOnPlan(PlanSlug.FREE);
  }

  /**
   * Checks if the user is on a paid plan (Basic, Pro or Enterprise)
   */
  isPaidPlan(): boolean {
    return (
      this.isOnPlan(PlanSlug.BASIC) ||
      this.isOnPlan(PlanSlug.PRO) ||
      this.isOnPlan(PlanSlug.ENTERPRISE)
    );
  }

  /**
   * Checks if the user's plan has expired
   */
  isPlanExpired(): boolean {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return false;
    return currentPlan.context.isExpired;
  }

  /**
   * Returns the current plan slug
   */
  getCurrentPlanSlug(): PlanSlug | null {
    const currentPlan = this.currentPlanSubject.value;
    return currentPlan?.context.planSlug ?? null;
  }

  /**
   * Returns the current plan name
   */
  getCurrentPlanName(): string {
    const currentPlan = this.currentPlanSubject.value;
    return currentPlan?.plan.name ?? 'Unknown';
  }

  // ==================== Utility Methods ====================

  /**
   * Returns a user-friendly message about why a feature is locked
   */
  getFeatureLockedMessage(permission: Permission): string {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return 'Please log in to access this feature.';

    if (currentPlan.context.isExpired) {
      return 'Your subscription has expired. Please renew to access this feature.';
    }

    const planName = currentPlan.plan.name;
    return `This feature is not available on the ${planName} plan. Upgrade to unlock it.`;
  }

  /**
   * Returns a user-friendly message about limit reached
   */
  getLimitReachedMessage(limitType: 'categories' | 'transactions'): string {
    const currentPlan = this.currentPlanSubject.value;
    if (!currentPlan) return 'Limit reached.';

    const planName = currentPlan.plan.name;
    const limits = currentPlan.context.limits;

    if (limitType === 'categories') {
      const max = limits.maxCategories;
      return `You've reached the maximum of ${max} categories on the ${planName} plan. Upgrade for more.`;
    } else {
      const max = limits.maxTransactionsPerMonth;
      return `You've reached the maximum of ${max} transactions per month on the ${planName} plan. Upgrade for more.`;
    }
  }

  /**
   * Clears the cached plan data
   */
  clearPlanCache(): void {
    this.currentPlanSubject.next(null);
    this.availablePlansSubject.next([]);
  }
}
