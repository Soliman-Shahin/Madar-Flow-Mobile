import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { PermissionService } from '../services/permission.service';
import { Permission } from '../../shared/models/plan.model';
import { ToastService } from '../../shared/services/toast.service';

/**
 * Permission Guard (Functional Guard - Angular 15+)
 *
 * Prevents access to routes that require specific permissions.
 * Uses the new PermissionService with Signals for reactive state management.
 *
 * Usage in routes:
 *   canActivate: [permissionGuard],
 *   data: {
 *     requiredPermission: Permission.EXPENSE_EXPORT,
 *     // OR
 *     requiredPermissions: [Permission.EXPENSE_EXPORT, Permission.REPORT_ADVANCED],
 *     requireAllPermissions: true // default is false (any permission)
 *   }
 */
export const permissionGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const permissionService = inject(PermissionService);
  const router = inject(Router);
  const toastService = inject(ToastService);

  const requiredPermission = route.data['requiredPermission'] as Permission | undefined;
  const requiredPermissions = route.data['requiredPermissions'] as Permission[] | undefined;
  const requireAll = route.data['requireAllPermissions'] as boolean | undefined;

  // If no permission requirement specified, allow access
  if (!requiredPermission && !requiredPermissions) {
    return true;
  }

  try {
    // Check if permissions are loaded
    if (!permissionService.arePermissionsLoaded()) {
      await permissionService.loadUserPermissions();
    }

    let hasAccess = false;

    if (requiredPermission) {
      // Single permission check - use API for critical routes
      hasAccess = await permissionService.checkPermissionAPI(requiredPermission);
    } else if (requiredPermissions) {
      // Multiple permissions check
      if (requireAll) {
        hasAccess = permissionService.hasAllPermissions(requiredPermissions);
      } else {
        hasAccess = permissionService.hasAnyPermission(requiredPermissions);
      }
    }

    if (hasAccess) {
      return true;
    }

    // Permission denied - show appropriate message
    await toastService.show({
      message: 'GUARDS.NO_PERMISSION',
      color: 'warning',
      duration: 3000,
      position: 'bottom',
    });

    // Navigate to subscription/upgrade page with returnUrl
    router.navigate(['/subscription'], {
      queryParams: { returnUrl: state.url }
    });
    return false;
  } catch (error) {
    console.error('Error in permissionGuard:', error);
    await toastService.show({
      message: 'GUARDS.PERMISSION_CHECK_FAILED',
      color: 'danger',
      duration: 3000,
      position: 'bottom',
    });
    return false;
  }
};

/**
 * Helper function to create a permission guard for a specific permission
 * Makes route configuration cleaner
 */
export function createPermissionGuard(permission: Permission): CanActivateFn {
  return (route, state) => {
    route.data = { ...route.data, requiredPermission: permission };
    return permissionGuard(route, state);
  };
}
