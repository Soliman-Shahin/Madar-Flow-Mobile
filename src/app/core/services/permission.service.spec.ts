import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PermissionService } from './permission.service';
import { Permission } from '../../shared/models/plan.model';

describe('PermissionService', () => {
  let service: PermissionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PermissionService);
    http = TestBed.inject(HttpTestingController);
    spyOn(console, 'error');
  });
  afterEach(() => http.verify());

  async function load(perms: Permission[]) {
    const p = service.loadUserPermissions();
    http.expectOne((r) => r.url.endsWith('/scopes/me')).flush({ success: true, data: { permissions: perms } });
    await p;
  }

  it('loads permissions and derives capability flags', async () => {
    expect(service.arePermissionsLoaded()).toBeFalse();
    await load([Permission.EXPENSE_EXPORT, Permission.BACKUP_LOCAL, Permission.SYNC_MULTI_DEVICE]);
    expect(service.getPermissionsCount()).toBe(3);
    expect(service.canExport()).toBeTrue();
    expect(service.canBackup()).toBeTrue();
    expect(service.canSync()).toBeTrue();
    expect(service.hasAdvancedReports()).toBeFalse();
    expect(service.hasAdminAccess()).toBeFalse();
    expect(service.loading()).toBeFalse();
  });

  it('checks single, all and any permissions and prefixes', async () => {
    await load([Permission.ADMIN_USERS, Permission.ADMIN_SYNC]);
    expect(service.hasPermission(Permission.ADMIN_USERS)).toBeTrue();
    expect(service.hasAllPermissions([Permission.ADMIN_USERS, Permission.ADMIN_SYNC])).toBeTrue();
    expect(service.hasAllPermissions([Permission.ADMIN_USERS, Permission.EXPENSE_EXPORT])).toBeFalse();
    expect(service.hasAnyPermission([Permission.EXPENSE_EXPORT, Permission.ADMIN_SYNC])).toBeTrue();
    expect(service.getPermissionsByPrefix('admin:').length).toBe(2);
    expect(service.createPermissionComputed(Permission.ADMIN_USERS)()).toBeTrue();
    expect(service.createAllPermissionsComputed([Permission.EXPENSE_EXPORT])()).toBeFalse();
    expect(service.createAnyPermissionComputed([Permission.ADMIN_SYNC])()).toBeTrue();
  });

  it('stores the server message when loading fails and clears on logout', async () => {
    const p = service.loadUserPermissions();
    http.expectOne((r) => r.url.endsWith('/scopes/me')).flush({ message: 'nope' }, { status: 500, statusText: 'Error' });
    await expectAsync(p).toBeRejected();
    expect(service.error()).toBe('nope');
    service.clearPermissions();
    expect(service.error()).toBeNull();
    expect(service.permissions()).toEqual([]);
  });

  it('server-side check returns false on failure', async () => {
    const ok = service.checkPermissionAPI(Permission.ADMIN_USERS);
    http.expectOne((r) => r.url.endsWith('/scopes/check/admin:users')).flush({ success: true, data: { hasScope: true } });
    expect(await ok).toBeTrue();
    const bad = service.checkPermissionAPI(Permission.ADMIN_USERS);
    http.expectOne((r) => r.url.includes('/scopes/check/')).error(new ProgressEvent('error'));
    expect(await bad).toBeFalse();
  });

  it('reports every permission as missing when the lookup fails', async () => {
    const req = [Permission.EXPENSE_EXPORT, Permission.ADMIN_USERS];
    const p = service.getMissingPermissions(req);
    http.expectOne((r) => r.url.endsWith('/scopes/missing')).error(new ProgressEvent('error'));
    expect(await p).toEqual(req);
    const q = service.getMissingPermissions(req);
    http
      .expectOne((r) => r.url.endsWith('/scopes/missing'))
      .flush({ success: true, data: { missingPermissions: [Permission.ADMIN_USERS] } });
    expect(await q).toEqual([Permission.ADMIN_USERS]);
  });

  it('refresh reloads from the server', async () => {
    const p = service.refreshPermissions();
    http.expectOne((r) => r.url.endsWith('/scopes/me')).flush({ success: true, data: { permissions: [Permission.REPORT_ADVANCED] } });
    await p;
    expect(service.hasAdvancedReports()).toBeTrue();
  });
});
