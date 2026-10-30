import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MyPlanResponse, Plan } from '../../shared/models/plan.model';
import { TokenService } from '../../modules/auth/services/token.service';
import { PlanService } from './plan.service';
import { StorePackage, StorePurchasesGateway } from './store-purchases.gateway';
import { StorePurchasesService, baseProductId } from './store-purchases.service';

const pkg = (productId: string, cycle: StorePackage['cycle'] = 'monthly'): StorePackage => ({
  id: '$rc_' + productId,
  productId,
  priceString: '$1.00',
  cycle,
  native: {} as StorePackage['native'],
});

const my = (slug: string, key: string | null = 'goog_public'): MyPlanResponse =>
  ({
    plan: null,
    context: { planSlug: slug, permissions: [] },
    billing: key ? { provider: 'revenuecat', androidPublicKey: key } : null,
  }) as unknown as MyPlanResponse;

describe('StorePurchasesService', () => {
  let service: StorePurchasesService;
  let gateway: jasmine.SpyObj<StorePurchasesGateway> & { supported: boolean };
  let planService: jasmine.SpyObj<PlanService>;
  let sessionEnded: Subject<void>;
  let userId: string | null;

  beforeEach(() => {
    userId = 'user-1';
    sessionEnded = new Subject<void>();
    gateway = Object.assign(
      jasmine.createSpyObj<StorePurchasesGateway>('gateway', [
        'configure',
        'logIn',
        'logOut',
        'packages',
        'purchase',
        'restore',
        'isCancelled',
      ]),
      { supported: true }
    );
    gateway.isCancelled.and.callFake((e: unknown) => (e as { userCancelled?: boolean })?.userCancelled === true);
    gateway.configure.and.resolveTo();
    gateway.logIn.and.resolveTo();
    gateway.logOut.and.resolveTo();
    gateway.purchase.and.resolveTo();
    gateway.restore.and.resolveTo();
    gateway.packages.and.resolveTo([pkg('pro_monthly:monthly')]);

    planService = jasmine.createSpyObj<PlanService>('plans', ['getMyPlan', 'syncPurchases']);
    planService.syncPurchases.and.resolveTo();
    planService.getMyPlan.and.resolveTo(my('free'));

    TestBed.configureTestingModule({
      providers: [
        { provide: StorePurchasesGateway, useValue: gateway },
        { provide: PlanService, useValue: planService },
        {
          provide: TokenService,
          useValue: { getUserId: () => userId, sessionEnded$: sessionEnded.asObservable() },
        },
      ],
    });
    service = TestBed.inject(StorePurchasesService);
    service.pollDelayMs = 0;
    service.pollAttempts = 5;
  });

  it('is available only on a supported device with a server-provided key', () => {
    expect(service.isAvailable(my('free'))).toBeTrue();
    expect(service.isAvailable(my('free', null))).toBeFalse();
    expect(service.isAvailable(null)).toBeFalse();
    gateway.supported = false;
    expect(service.isAvailable(my('free'))).toBeFalse();
  });

  it('identifies the SDK as the signed-in user, once, and switches users with logIn', async () => {
    await service.loadPackages(my('free'));
    await service.loadPackages(my('free'));
    expect(gateway.configure).toHaveBeenCalledOnceWith('goog_public', 'user-1');

    userId = 'user-2';
    await service.loadPackages(my('free'));
    expect(gateway.logIn).toHaveBeenCalledOnceWith('user-2');
  });

  it('never talks to the store without a signed-in user', async () => {
    userId = null;
    expect(await service.loadPackages(my('free'))).toEqual([]);
    expect(gateway.configure).not.toHaveBeenCalled();
  });

  it('returns no offers (instead of throwing) when the store is unavailable', async () => {
    gateway.packages.and.rejectWith(new Error('billing unavailable'));
    expect(await service.loadPackages(my('free'))).toEqual([]);
  });

  it('matches offers to a plan by product id, ignoring the base-plan suffix', () => {
    const all = [pkg('pro_monthly:monthly'), pkg('pro_yearly:yearly', 'yearly'), pkg('premium_monthly:m')];
    const pro = { slug: 'pro', productIds: ['pro_monthly', 'pro_yearly'] } as unknown as Plan;
    expect(service.packagesFor(pro, all).map((p) => p.productId)).toEqual([
      'pro_monthly:monthly',
      'pro_yearly:yearly',
    ]);
    expect(service.packagesFor({ slug: 'free' } as unknown as Plan, all)).toEqual([]);
    expect(baseProductId('a:b:c')).toBe('a');
  });

  it('purchase is active once the server shows the plan', async () => {
    planService.getMyPlan.and.returnValues(Promise.resolve(my('free')), Promise.resolve(my('pro')));
    const outcome = await service.purchase(my('free'), pkg('pro_monthly:monthly'), 'pro');
    expect(outcome).toBe('active');
    expect(gateway.purchase).toHaveBeenCalled();
  });

  it('purchase stays pending when the server has not confirmed it, after asking the server to re-check', async () => {
    const outcome = await service.purchase(my('free'), pkg('pro_monthly:monthly'), 'pro');
    expect(outcome).toBe('pending');
    expect(planService.syncPurchases).toHaveBeenCalledTimes(1);
    expect(planService.getMyPlan).toHaveBeenCalledTimes(5);
  });

  it('waits for the new plan when switching between paid plans', async () => {
    planService.getMyPlan.and.returnValues(
      Promise.resolve(my('pro')),
      Promise.resolve(my('premium'))
    );
    const outcome = await service.purchase(my('pro'), pkg('premium_monthly'), 'premium');
    expect(outcome).toBe('active');
    expect(planService.getMyPlan).toHaveBeenCalledTimes(2);
  });

  it('a closed store sheet is "cancelled", not an error; a real failure is "failed"', async () => {
    gateway.purchase.and.rejectWith({ userCancelled: true });
    expect(await service.purchase(my('free'), pkg('x'), 'pro')).toBe('cancelled');
    gateway.purchase.and.rejectWith(new Error('declined'));
    expect(await service.purchase(my('free'), pkg('x'), 'pro')).toBe('failed');
    expect(planService.getMyPlan).not.toHaveBeenCalled();
  });

  it('restore re-links purchases, asks the server, and reports the result', async () => {
    planService.getMyPlan.and.resolveTo(my('pro'));
    expect(await service.restore(my('free'))).toBe('restored');
    expect(gateway.restore).toHaveBeenCalled();
    expect(planService.syncPurchases).toHaveBeenCalled();

    planService.getMyPlan.and.resolveTo(my('free'));
    expect(await service.restore(my('free'))).toBe('nothing');

    gateway.restore.and.rejectWith(new Error('offline'));
    expect(await service.restore(my('free'))).toBe('failed');
  });

  it('logs the SDK out when the app session ends', async () => {
    await service.loadPackages(my('free'));
    sessionEnded.next();
    await Promise.resolve();
    expect(gateway.logOut).toHaveBeenCalled();
    // The next sign-in configures again from scratch.
    userId = 'user-3';
    await service.loadPackages(my('free'));
    expect(gateway.configure).toHaveBeenCalledTimes(2);
  });
});
