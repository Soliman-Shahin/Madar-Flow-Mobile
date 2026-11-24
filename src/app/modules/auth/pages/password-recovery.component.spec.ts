import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { BiometricSignInService } from '../services/biometric-signin.service';
import {
  ForgotPasswordComponent,
  ResetPasswordComponent,
} from './password-recovery.component';

@Component({ standalone: true, template: '' })
class BlankPage {}

/**
 * Both screens are OnPush. After the HTTP response the view must update by itself: the notice
 * appears and the spinner goes away. (They used BehaviorSubjects read through plain functions,
 * so on a real device the spinner stayed forever although the e-mail had been sent.)
 */
describe('password recovery screens (OnPush)', () => {
  const spinner = (el: HTMLElement) => el.querySelector('ion-spinner');
  const notice = (el: HTMLElement) => el.querySelector('.mf-auth__notice');
  const alert = (el: HTMLElement) => el.querySelector('.mf-auth__error');

  function setup(auth: object, token: string | null = null) {
    TestBed.configureTestingModule({
      imports: [
        ForgotPasswordComponent,
        ResetPasswordComponent,
        IonicModule.forRoot(),
        TranslateModule.forRoot(),
      ],
      providers: [
        provideRouter([{ path: 'auth/login', component: BlankPage }]),
        { provide: AuthService, useValue: auth },
        { provide: BiometricSignInService, useValue: { clearLocalEnrollment: () => Promise.resolve() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => token } } } },
      ],
    });
  }

  it('forgot password: spinner shows while sending, then the notice replaces it', () => {
    const response = new Subject<object>();
    setup({ requestPasswordReset: () => response });
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: 'user@example.com' });
    fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(spinner(fixture.nativeElement)).not.toBeNull();
    expect(notice(fixture.nativeElement)).toBeNull();

    response.next({});
    response.complete();
    fixture.detectChanges();
    expect(spinner(fixture.nativeElement)).toBeNull();
    expect(notice(fixture.nativeElement)).not.toBeNull();
  });

  it('forgot password: a failed request also ends the spinner and shows the generic notice', () => {
    const response = new Subject<object>();
    setup({ requestPasswordReset: () => response });
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: 'user@example.com' });
    fixture.componentInstance.submit();
    fixture.detectChanges();

    response.error(new Error('network'));
    fixture.detectChanges();
    expect(spinner(fixture.nativeElement)).toBeNull();
    expect(notice(fixture.nativeElement)).not.toBeNull();
  });

  it('reset password: success replaces the form with the success notice', () => {
    const response = new Subject<object>();
    setup({ resetPassword: () => response }, 'a1b2c3d4e5f60718');
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ password: 'Aa1!aaaa', confirm: 'Aa1!aaaa' });
    fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(spinner(fixture.nativeElement)).not.toBeNull();

    response.next({});
    response.complete();
    fixture.detectChanges();
    expect(spinner(fixture.nativeElement)).toBeNull();
    expect(notice(fixture.nativeElement)).not.toBeNull();
  });

  it('reset password: an invalid or expired link shows the error instead of spinning', () => {
    const response = new Subject<object>();
    setup({ resetPassword: () => response }, 'a1b2c3d4e5f60718');
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ password: 'Aa1!aaaa', confirm: 'Aa1!aaaa' });
    fixture.componentInstance.submit();
    fixture.detectChanges();

    response.error({ status: 400 });
    fixture.detectChanges();
    expect(spinner(fixture.nativeElement)).toBeNull();
    expect(alert(fixture.nativeElement)).not.toBeNull();
  });
});
