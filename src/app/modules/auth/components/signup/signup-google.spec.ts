import { BehaviorSubject, of, Subject } from 'rxjs';
import { SignupComponent } from './signup.component';
import { CONSENT_VERSIONS } from 'src/app/config/consent.config';

describe('SignupComponent Google authentication', () => {
  function componentWith(consent: boolean): any {
    const component = Object.create(SignupComponent.prototype) as any;
    // `termsAccepted` is a getter on the component; shadow it on this instance.
    Object.defineProperty(component, 'termsAccepted', {
      value: { value: consent },
    });
    component.signupForm = { markAllAsTouched: jasmine.createSpy('markAllAsTouched') };
    component.loading = new BehaviorSubject(false);
    component.errorMessage = new BehaviorSubject('');
    component.destroy$ = new Subject<void>();
    component.translateService = { instant: () => 'signup failed' };
    component.authService = {
      loginWithGoogle: jasmine
        .createSpy('loginWithGoogle')
        .and.returnValue(of(void 0)),
    };
    return component;
  }

  it('does not start Google signup before required consent', () => {
    const component = componentWith(false);

    component.signInWithGoogle();

    expect(component.authService.loginWithGoogle).not.toHaveBeenCalled();
    expect(component.isSubmitted).toBeTrue();
    expect(component.signupForm.markAllAsTouched).toHaveBeenCalled();
  });

  it('starts Google signup with the current consent contract after acceptance', () => {
    const component = componentWith(true);

    component.signInWithGoogle();

    expect(component.authService.loginWithGoogle).toHaveBeenCalledWith({
      termsAccepted: true,
      privacyAccepted: true,
      ...CONSENT_VERSIONS,
    });
  });
});
