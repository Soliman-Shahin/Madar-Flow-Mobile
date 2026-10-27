/**
 * Permission Service
 *
 * Manages user permissions with Signals for reactive state management.
 * Provides methods to check permissions and handle permission-related operations.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { map, tap, finalize } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Permission } from '../../shared/models/plan.model';

interface PermissionResponse {
  success: boolean;
  data: {
    permissions: Permission[];
  };
}

interface CheckPermissionResponse {
  success: boolean;
  data: {
    hasScope: boolean;
  };
}

interface MissingPermissionsResponse {
  success: boolean;
  data: {
    missingPermissions: Permission[];
  };
}

@Injectable({
  providedIn: 'root',
})
export class PermissionService {
  private http = inject(HttpClient);
  private apiUrl = Capacitor.isNativePlatform()
    ? environment.nativeApiUrl
    : environment.browserApiUrl;

  // Signals for reactive state management
  private permissionsSignal = signal<Permission[]>([]);
  private loadingSignal = signal<boolean>(false);
  private errorSignal = signal<string | null>(null);

  // Public readonly signals
  readonly permissions = this.permissionsSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  // Computed signals for common checks
  readonly hasAdminAccess = computed(() =>
    this.permissions().some((p) => p.startsWith('admin:'))
  );

  readonly canExport = computed(() =>
    this.permissions().includes(Permission.EXPENSE_EXPORT)
  );

  readonly canBackup = computed(() =>
    this.permissions().some((p) => p.startsWith('backup:'))
  );

  readonly canSync = computed(() =>
    this.permissions().includes(Permission.SYNC_MULTI_DEVICE)
  );

  readonly hasAdvancedReports = computed(() =>
    this.permissions().includes(Permission.REPORT_ADVANCED)
  );

  // ==================== Public API ====================

  /**
   * Load user permissions from backend
   * This should be called on app initialization
   */
  async loadUserPermissions(): Promise<Permission[]> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<PermissionResponse>(`${this.apiUrl}/scopes/me`)
      );

      const permissions = response.data.permissions;
      this.permissionsSignal.set(permissions);
      return permissions;
    } catch (error: any) {
      const errorMessage = error?.error?.message || 'Failed to load permissions';
      this.errorSignal.set(errorMessage);
      console.error('Error loading permissions:', error);
      throw error;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /**
   * Check if user has a specific permission (client-side check)
   * For critical operations, use checkPermissionAPI instead
   */
  hasPermission(permission: Permission): boolean {
    return this.permissions().includes(permission);
  }

  /**
   * Check if user has all specified permissions
   */
  hasAllPermissions(requiredPermissions: Permission[]): boolean {
    const userPermissions = this.permissions();
    return requiredPermissions.every((p) => userPermissions.includes(p));
  }

  /**
   * Check if user has any of the specified permissions
   */
  hasAnyPermission(requiredPermissions: Permission[]): boolean {
    const userPermissions = this.permissions();
    return requiredPermissions.some((p) => userPermissions.includes(p));
  }

  /**
   * Check permission via API (for critical operations)
   * This performs a server-side verification
   */
  async checkPermissionAPI(permission: Permission): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.get<CheckPermissionResponse>(
          `${this.apiUrl}/scopes/check/${permission}`
        )
      );
      return response.data.hasScope;
    } catch (error) {
      console.error('Error checking permission:', error);
      return false;
    }
  }

  /**
   * Get missing permissions from a list of required permissions
   */
  async getMissingPermissions(
    requiredPermissions: Permission[]
  ): Promise<Permission[]> {
    try {
      const response = await firstValueFrom(
        this.http.post<MissingPermissionsResponse>(
          `${this.apiUrl}/scopes/missing`,
          { requiredScopes: requiredPermissions }
        )
      );
      return response.data.missingPermissions;
    } catch (error) {
      console.error('Error getting missing permissions:', error);
      return requiredPermissions; // Return all as missing on error
    }
  }

  /**
   * Get permissions by group (e.g., all admin permissions)
   */
  getPermissionsByPrefix(prefix: string): Permission[] {
    return this.permissions().filter((p) => p.startsWith(prefix));
  }

  /**
   * Clear permissions cache (call on logout)
   */
  clearPermissions(): void {
    this.permissionsSignal.set([]);
    this.errorSignal.set(null);
  }

  /**
   * Refresh permissions from server
   */
  async refreshPermissions(): Promise<void> {
    await this.loadUserPermissions();
  }

  /**
   * Get current permissions count
   */
  getPermissionsCount(): number {
    return this.permissions().length;
  }

  /**
   * Check if permissions are loaded
   */
  arePermissionsLoaded(): boolean {
    return this.permissions().length > 0;
  }

  // ==================== Helper Methods ====================

  /**
   * Create a computed signal for a specific permission check
   * Useful for reactive UI updates
   */
  createPermissionComputed(permission: Permission) {
    return computed(() => this.hasPermission(permission));
  }

  /**
   * Create a computed signal for multiple permissions (all required)
   */
  createAllPermissionsComputed(permissions: Permission[]) {
    return computed(() => this.hasAllPermissions(permissions));
  }

  /**
   * Create a computed signal for multiple permissions (any required)
   */
  createAnyPermissionComputed(permissions: Permission[]) {
    return computed(() => this.hasAnyPermission(permissions));
  }
}
