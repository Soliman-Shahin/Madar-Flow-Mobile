import { Injectable, inject } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { OfflineStorageService } from './offline-storage.service';
import { PlanService } from './plan.service';

export type PlanLimitKind = 'categories' | 'transactions';

/** Thrown when a create is refused locally because the plan limit is reached. */
export class LocalPlanLimitError extends Error {
  readonly code = 'PLAN_LIMIT_EXCEEDED';
  constructor(
    readonly limitType: PlanLimitKind,
    readonly currentCount: number,
    readonly maxAllowed: number
  ) {
    super('PLAN_LIMIT_EXCEEDED');
    Object.setPrototypeOf(this, LocalPlanLimitError.prototype);
  }
}

export const isPlanLimitError = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === 'PLAN_LIMIT_EXCEEDED';

/**
 * Stops a new record from being saved on the device when it could never be
 * synced, so the person learns about the limit while adding it, not days later.
 *
 * It uses the limits the server last confirmed (kept across restarts) and what
 * is stored locally. With no known limit nothing is blocked: the server stays
 * the authority.
 */
@Injectable({ providedIn: 'root' })
export class PlanLimitGuardService {
  private readonly offlineStorage = inject(OfflineStorageService);
  private readonly planService = inject(PlanService);

  /** Emits once when a create is allowed; errors with LocalPlanLimitError otherwise. */
  assertCanCreate(kind: PlanLimitKind): Observable<void> {
    const limits = this.planService.getKnownLimits();
    const max =
      kind === 'categories'
        ? limits?.maxCategories
        : limits?.maxTransactionsPerMonth;
    if (max === null || max === undefined) return of(void 0);

    return from(this.offlineStorage.countPlanUsage()).pipe(
      switchMap((usage) => {
        const used =
          kind === 'categories'
            ? usage.categories
            : usage.transactionsThisMonth;
        return used >= max
          ? throwError(() => new LocalPlanLimitError(kind, used, max))
          : of(void 0);
      })
    );
  }
}
