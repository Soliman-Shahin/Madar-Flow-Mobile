/**
 * Role Guard (Functional Guard - Angular 15+)
 *
 * Prevents access to routes that require a specific user role.
 * Uses ROLE_WEIGHTS from role.model for consistent role hierarchy.
 */

import { inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { UserRole, hasRoleLevel } from '../models/role.model';

/** i18n key for a role's display name (ROLES.USER, ROLES.SUPERADMIN, ...). */
const roleNameKey = (role: UserRole): string => `ROLES.${String(role).toUpperCase()}`;
import { ToastService } from '../../shared/services/toast.service';

// This would typically come from an AuthService
// For now, we'll inject it when available
interface AuthService {
  getCurrentUser(): { role: UserRole } | null;
}

/**
 * Role Guard
 *
 * Usage in routes:
 *   canActivate: [roleGuard],
 *   data: { requiredRole: UserRole.ADMIN }
 */
export const roleGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const router = inject(Router);
  const toastService = inject(ToastService);
  const translate = inject(TranslateService);
  
  // TODO: Inject AuthService when available
  // const authService = inject(AuthService);
  
  const requiredRole = route.data['requiredRole'] as UserRole | undefined;

  if (!requiredRole) {
    // No role requirement specified, allow access
    return true;
  }

  try {
    // TODO: Get current user from AuthService
    // const currentUser = authService.getCurrentUser();
    
    // For now, return false and show message
    // This will be updated when AuthService is integrated
    
    await toastService.show({
      message: translate.instant('GUARDS.ROLE_REQUIRED', {
        required: translate.instant(roleNameKey(requiredRole)),
      }),
      color: 'warning',
      duration: 3000,
      position: 'bottom',
    });
    
    router.navigate(['/'], {
      queryParams: { returnUrl: state.url }
    });
    return false;
    
    /* 
    // Future implementation:
    if (!currentUser) {
      router.navigate(['/login']);
      return false;
    }

    // Check if user's role meets the requirement
    if (hasRoleLevel(currentUser.role, requiredRole)) {
      return true;
    }

    // Role requirement not met
    const currentRoleName = translate.instant(roleNameKey(currentUser.role));
    const requiredRoleName = translate.instant(roleNameKey(requiredRole));
    
    await toastService.show({
      message: translate.instant('GUARDS.ROLE_REQUIRED_CURRENT', {
        required: requiredRoleName,
        current: currentRoleName,
      }),
      color: 'warning',
      duration: 3000,
      position: 'bottom',
    });
    
    router.navigate(['/']);
    return false;
    */
  } catch (error) {
    console.error('Error in roleGuard:', error);
    await toastService.show({
      message: 'GUARDS.ROLE_CHECK_FAILED',
      color: 'danger',
      duration: 3000,
      position: 'bottom',
    });
    return false;
  }
};

/**
 * Helper function to create a role guard for a specific role
 * Makes route configuration cleaner
 */
export function createRoleGuard(role: UserRole): CanActivateFn {
  return (route, state) => {
    route.data = { ...route.data, requiredRole: role };
    return roleGuard(route, state);
  };
}

/**
 * Admin Guard - Shortcut for admin-only routes
 */
export const adminGuard: CanActivateFn = (route, state) => {
  route.data = { ...route.data, requiredRole: UserRole.ADMIN };
  return roleGuard(route, state);
};

/**
 * Super Admin Guard - Shortcut for super admin-only routes
 */
export const superAdminGuard: CanActivateFn = (route, state) => {
  route.data = { ...route.data, requiredRole: UserRole.SUPERADMIN };
  return roleGuard(route, state);
};
