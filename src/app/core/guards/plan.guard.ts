import { inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { PlanService } from '../services/plan.service';
import { PlanSlug, PLAN_WEIGHTS, isPlanSufficient, getPlanDisplayName } from '../../shared/models/plan.model';
import { ToastService } from '../../shared/services/toast.service';

/**
 * Plan Guard (Functional Guard - Angular 15+)
 *
 * Prevents access to routes that require a specific plan level.
 * Uses PLAN_WEIGHTS from plan.model for consistent plan hierarchy.
 *
 * Usage in routes:
 *   canActivate: [planGuard],
 *   data: { requiredPlan: PlanSlug.PRO }
 */
export const planGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const planService = inject(PlanService);
  const router = inject(Router);
  const toastService = inject(ToastService);
  const translate = inject(TranslateService);

  const requiredPlan = route.data['requiredPlan'] as PlanSlug | undefined;

  if (!requiredPlan) {
    // No plan requirement specified, allow access
    return true;
  }

  try {
    // Ensure we have the latest plan data
    const myPlan = await planService.getMyPlan();
    const userPlanSlug = myPlan.context.planSlug;

    // Check if user's plan meets the requirement using helper function
    if (isPlanSufficient(userPlanSlug, requiredPlan)) {
      // Check if plan is expired
      if (myPlan.context.isExpired) {
        await toastService.show({
          message: 'GUARDS.PLAN_EXPIRED',
          color: 'warning',
          duration: 3000,
          position: 'bottom',
        });
        router.navigate(['/subscription'], {
          queryParams: {
            reason: 'expired',
            plan: userPlanSlug,
            returnUrl: state.url
          }
        });
        return false;
      }
      return true;
    }

    // Plan requirement not met
    const currentPlanName = getPlanDisplayName(userPlanSlug);
    const requiredPlanName = getPlanDisplayName(requiredPlan);
    
    await toastService.show({
      message: translate.instant('GUARDS.PLAN_REQUIRED', {
        required: requiredPlanName,
        current: currentPlanName,
      }),
      color: 'warning',
      duration: 3000,
      position: 'bottom',
    });
    
    router.navigate(['/subscription'], {
      queryParams: {
        required: requiredPlan,
        current: userPlanSlug,
        returnUrl: state.url
      }
    });
    return false;
  } catch (error) {
    console.error('Error in planGuard:', error);
    await toastService.show({
      message: 'GUARDS.PLAN_CHECK_FAILED',
      color: 'danger',
      duration: 3000,
      position: 'bottom',
    });
    return false;
  }
};

/**
 * Helper function to create a plan guard for a specific plan
 * Makes route configuration cleaner
 */
export function createPlanGuard(plan: PlanSlug): CanActivateFn {
  return (route, state) => {
    route.data = { ...route.data, requiredPlan: plan };
    return planGuard(route, state);
  };
}
