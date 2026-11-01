import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { PlanService } from './plan.service';
import { TokenService } from '../../modules/auth/services/token.service';
import { Permission, PlanSlug } from '../../shared/models/plan.model';

function myPlan(over: any = {}) {
  return {
    plan: { name: 'Free' },
    context: {
      planSlug: PlanSlug.FREE,
      isExpired: false,
      permissions: [Permission.EXPENSE_EXPORT],
      limits: { maxCategories: 5, maxTransactionsPerMonth: 50 },
      ...(over.context ?? {}),
    },
    usage: {
      categories: { used: 3 },
      transactionsThisMonth: { used: 50 },
      ...(over.usage ?? {}),
    },
    ...(over.top ?? {}),
  } as any;
}

describe('PlanService', () => {
  let service: PlanService;
  let http: HttpTestingController;
  let ended: Subject<void>;
  let userId: string | null;

  beforeEach(() => {
    ended = new Subject<void>();
    userId = 'u1';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TokenService, useValue: { sessionEnded$: ended, getUserId: () => userId } },
      ],
    });
    service = TestBed.inject(PlanService);
    http = TestBed.inject(HttpTestingController);
    spyOn(console, 'error');
  });
  afterEach(() => http.verify());

  async function loadPlan(plan = myPlan()) {
    const p = service.getMyPlan();
    http.expectOne((r) => r.url.endsWith('/plans/me')).flush({ data: plan });
    await p;
  }

  it('denies everything before a plan is loaded', () => {
    expect(service.hasPermission(Permission.EXPENSE_EXPORT)).toBeFalse();
    expect(service.hasAnyPermission([Permission.EXPENSE_EXPORT])).toBeFalse();
    expect(service.hasAllPermissions([Permission.EXPENSE_EXPORT])).toBeFalse();
    expect(service.canAddCategory()).toBeFalse();
    expect(service.canAddTransaction()).toBeFalse();
    expect(service.getRemainingCategories()).toBe(0);
    expect(service.isFreePlan()).toBeFalse();
    expect(service.isPlanExpired()).toBeFalse();
    expect(service.getCurrentPlanSlug()).toBeNull();
    expect(service.getCurrentPlanName()).toBe('Unknown');
    expect(service.getFeatureLockedMessage(Permission.EXPENSE_EXPORT)).toContain('log in');
    expect(service.getLimitReachedMessage('categories')).toBe('Limit reached.');
  });

  it('evaluates permissions and limits against usage', async () => {
    await loadPlan();
    expect(service.hasPermission(Permission.EXPENSE_EXPORT)).toBeTrue();
    expect(service.hasPermission(Permission.ADMIN_USERS)).toBeFalse();
    expect(service.hasAnyPermission([Permission.ADMIN_USERS, Permission.EXPENSE_EXPORT])).toBeTrue();
    expect(service.hasAllPermissions([Permission.ADMIN_USERS, Permission.EXPENSE_EXPORT])).toBeFalse();
    expect(service.canAddCategory()).toBeTrue();
    expect(service.getRemainingCategories()).toBe(2);
    expect(service.canAddTransaction()).toBeFalse();
    expect(service.getRemainingTransactions()).toBe(0);
    expect(service.isFreePlan()).toBeTrue();
    expect(service.isPaidPlan()).toBeFalse();
    expect(service.getCurrentPlanName()).toBe('Free');
    expect(service.getLimitReachedMessage('categories')).toContain('maximum of 5 categories');
    expect(service.getLimitReachedMessage('transactions')).toContain('50 transactions');
    expect(service.getFeatureLockedMessage(Permission.ADMIN_USERS)).toContain('Free plan');
  });

  it('treats null limits as unlimited and reports expiry', async () => {
    await loadPlan(
      myPlan({
        context: {
          planSlug: PlanSlug.PRO,
          isExpired: true,
          limits: { maxCategories: null, maxTransactionsPerMonth: null },
        },
      })
    );
    expect(service.canAddCategory()).toBeTrue();
    expect(service.canAddTransaction()).toBeTrue();
    expect(service.getRemainingCategories()).toBeNull();
    expect(service.getRemainingTransactions()).toBeNull();
    expect(service.isPaidPlan()).toBeTrue();
    expect(service.isPlanExpired()).toBeTrue();
    expect(service.getFeatureLockedMessage(Permission.ADMIN_USERS)).toContain('expired');
  });

  it('loads available plans and surfaces fetch errors', async () => {
    const ok = service.getAvailablePlans();
    http.expectOne((r) => r.url.endsWith('/plans')).flush({ data: [{ name: 'Free' }] });
    expect((await ok).length).toBe(1);
    let emitted = 0;
    service.availablePlans$.subscribe((p) => (emitted = p.length));
    expect(emitted).toBe(1);

    const bad = service.getAvailablePlans();
    http.expectOne((r) => r.url.endsWith('/plans')).flush({}, { status: 500, statusText: 'Error' });
    await expectAsync(bad).toBeRejected();
  });

  it('does not publish a plan that arrives after the account changed', async () => {
    const p = service.getMyPlan();
    userId = 'u2';
    http.expectOne((r) => r.url.endsWith('/plans/me')).flush({ data: myPlan() });
    await p;
    expect(service.getCurrentPlanSlug()).toBeNull();
  });

  it('drops cached plan data when the session ends', async () => {
    await loadPlan();
    expect(service.isFreePlan()).toBeTrue();
    ended.next();
    expect(service.isFreePlan()).toBeFalse();
  });

  it('upgrade posts the plan then refreshes the current plan', async () => {
    const p = service.upgradePlan(PlanSlug.PRO, 'ref-1');
    const up = http.expectOne((r) => r.url.endsWith('/plans/upgrade'));
    expect(up.request.body).toEqual({ planSlug: PlanSlug.PRO, paymentRef: 'ref-1' });
    up.flush({ data: { ok: true } });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne((r) => r.url.endsWith('/plans/me')).flush({ data: myPlan() });
    expect(await p).toEqual({ ok: true });
  });

  it('syncPurchases posts to billing/sync', async () => {
    const p = service.syncPurchases();
    http.expectOne((r) => r.url.endsWith('/billing/sync')).flush({});
    await p;
  });
});
