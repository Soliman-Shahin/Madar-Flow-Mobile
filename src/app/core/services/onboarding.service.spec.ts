import { OnboardingService } from './onboarding.service';

/** In-memory stand-in for the storage service the onboarding flow persists through. */
function storageStub(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    set: (key: string, value: unknown) => void data.set(key, value),
  };
}

function create(initial: Record<string, unknown> = { app_version: '1.0.1' }) {
  const storage = storageStub(initial);
  const service = new OnboardingService(storage as any);
  return { service, storage };
}

describe('OnboardingService', () => {
  it('starts on the first step and shows onboarding on a fresh install', () => {
    const { service, storage } = create({});
    expect(service.shouldShowOnboarding()).toBeTrue();
    expect(service.isFirstStep()).toBeTrue();
    expect(service.getCurrentStep()?.id).toBe('welcome');
    // A fresh install records the app version so it is not reset again next launch.
    expect(storage.data.get('app_version')).toBe('1.0.1');
  });

  it('walks forward and backward, clamping at the first step', () => {
    const { service } = create();
    service.previousStep();
    expect(service.isFirstStep()).toBeTrue();
    service.nextStep();
    expect(service.getCurrentStep()?.id).toBe('expenses');
    service.previousStep();
    expect(service.isFirstStep()).toBeTrue();
  });

  it('reports progress and last step, completing when advancing past the end', () => {
    const { service } = create();
    const total = service.getCurrentState().steps.length;
    expect(service.getProgress()).toBeCloseTo(100 / total);
    for (let i = 0; i < total - 1; i++) service.nextStep();
    expect(service.isLastStep()).toBeTrue();
    expect(service.getProgress()).toBe(100);
    service.nextStep();
    expect(service.getCurrentState().isCompleted).toBeTrue();
    expect(service.shouldShowOnboarding()).toBeFalse();
  });

  it('goToStep ignores out-of-range indexes', () => {
    const { service } = create();
    service.goToStep(3);
    expect(service.getCurrentStep()?.id).toBe('analytics');
    service.goToStep(-1);
    service.goToStep(99);
    expect(service.getCurrentStep()?.id).toBe('analytics');
  });

  it('skip persists and hides onboarding; showOnboardingAgain brings it back', () => {
    const { service, storage } = create();
    service.skipOnboarding();
    expect(service.shouldShowOnboarding()).toBeFalse();
    expect((storage.data.get('onboarding_status') as any).isSkipped).toBeTrue();
    service.showOnboardingAgain();
    expect(service.shouldShowOnboarding()).toBeTrue();
    expect(service.isFirstStep()).toBeTrue();
  });

  it('restores stored progress but always uses the latest steps', () => {
    const { service } = create({
      app_version: '1.0.1',
      onboarding_status: { steps: [], currentStep: 2, isCompleted: false, isSkipped: false },
    });
    expect(service.getCurrentStep()?.id).toBe('categories');
  });

  it('resets onboarding when the app version changes', () => {
    const { service, storage } = create({
      app_version: '0.9.0',
      onboarding_status: { steps: [], currentStep: 4, isCompleted: true, isSkipped: false },
    });
    expect(service.shouldShowOnboarding()).toBeTrue();
    expect(service.isFirstStep()).toBeTrue();
    expect(storage.data.get('app_version')).toBe('1.0.1');
  });

  it('inserts custom steps at a position or appends them', () => {
    const { service } = create();
    const step = { id: 'custom', title: 't', description: 'd', icon: 'star' };
    service.addCustomStep(step, 1);
    expect(service.getCurrentState().steps[1].id).toBe('custom');
    service.addCustomStep({ ...step, id: 'tail' });
    const steps = service.getCurrentState().steps;
    expect(steps[steps.length - 1].id).toBe('tail');
    service.addCustomStep({ ...step, id: 'bad-pos' }, 999);
    const after = service.getCurrentState().steps;
    expect(after[after.length - 1].id).toBe('bad-pos');
  });
});
