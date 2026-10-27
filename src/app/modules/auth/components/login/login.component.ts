import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  Validators,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  BehaviorSubject,
  combineLatest,
  finalize,
  Observable,
  takeUntil,
} from 'rxjs';
import { map } from 'rxjs/operators';

import { BaseComponent } from 'src/app/shared/base/base.component';
import { IonicModule } from '@ionic/angular';
import { UiInputComponent } from '../../../../shared/ui/ui-input/ui-input.component';
import { RouterLink } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { BiometricSignInService } from '../../services/biometric-signin.service';
import { Platform } from '@ionic/angular';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    IonicModule,
    FormsModule,
    ReactiveFormsModule,
    UiInputComponent,
    RouterLink,
    AsyncPipe,
    TranslateModule,
  ],
})
export class LoginComponent extends BaseComponent implements OnInit {
  loginForm!: FormGroup;
  hide = true;
  private readonly loading = new BehaviorSubject<boolean>(false);
  private readonly errorMessage = new BehaviorSubject<string>('');
  biometricSignInAvailable = false;
  biometricSignInInProgress = false;
  private biometricLoaderShown = false;
  private biometricSignInService = inject(BiometricSignInService);
  private platform = inject(Platform);

  readonly vm$ = combineLatest({
    isLoading: this.loading.asObservable(),
    errorMessage: this.errorMessage.asObservable(),
  });

  // Form control names for template access
  readonly formFields = {
    email: 'email',
    password: 'password',
    rememberMe: 'rememberMe',
  };

  constructor() {
    super();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    this.initForm();
    void this.refreshBiometricSignInAvailability();
  }

  private async refreshBiometricSignInAvailability() {
    await this.platform.ready();
    this.biometricSignInAvailable =
      (await this.biometricSignInService.isAvailable()) &&
      (await this.biometricSignInService.hasEnrollment());
    this.cdr.markForCheck();
  }
  signInWithBiometrics(): void {
    if (this.biometricSignInInProgress) return;
    this.biometricSignInInProgress = true;
    this.biometricLoaderShown = false;
    this.handleAuth(
      this.biometricSignInService.signIn(() => {
        this.biometricLoaderShown = true;
        this.loadingService.show(
          'auth-biometric',
          this.translateService.instant('AUTH.BIOMETRIC_SIGNIN_PROCESSING')
        );
      }),
      true
    );
  }

  // Ensure UI resets correctly when returning to login (e.g., after logout)
  ionViewWillEnter(): void {
    void this.refreshBiometricSignInAvailability();
    this.loading.next(false);
    this.errorMessage.next('');
    if (this.loginForm) {
      this.loginForm.reset({
        email: localStorage.getItem('savedEmail') || '',
        password: '',
        rememberMe: this.loginForm.get(this.formFields.rememberMe)?.value,
      });
    }
  }

  togglePasswordVisibility(): void {
    this.hide = !this.hide;
  }

  private initForm(): void {
    const savedEmail = localStorage.getItem('savedEmail') || '';
    const rememberMe =
      localStorage.getItem('madarflow_auth_persistent') === 'true';

    this.loginForm = new FormGroup({
      [this.formFields.email]: new FormControl(savedEmail, {
        validators: [
          Validators.required,
          Validators.email,
          Validators.maxLength(100),
        ],
        updateOn: 'change',
      }),
      [this.formFields.password]: new FormControl('', {
        validators: [
          Validators.required,
          Validators.minLength(6),
          Validators.maxLength(50),
        ],
        updateOn: 'change',
      }),
      [this.formFields.rememberMe]: new FormControl(rememberMe),
    });
  }

  get email() {
    return this.loginForm.get(this.formFields.email);
  }

  get password() {
    return this.loginForm.get(this.formFields.password);
  }

  signInWithGoogle(): void {
    this.handleAuth(this.authService.loginWithGoogle());
  }

  login(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { email, password, rememberMe } = this.loginForm.value;

    if (rememberMe) {
      localStorage.setItem('savedEmail', email);
    } else {
      localStorage.removeItem('savedEmail');
    }

    this.handleAuth(this.authService.login(email, password, !!rememberMe));
  }

  private handleAuth(
    authObservable: Observable<any>,
    biometricTransaction = false
  ): void {
    this.loading.next(true);
    this.errorMessage.next('');

    authObservable
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.loading.next(false);
          if (biometricTransaction && this.biometricLoaderShown) {
            this.loadingService.hide('auth-biometric');
            this.biometricLoaderShown = false;
          }
          if (biometricTransaction) this.biometricSignInInProgress = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (res) => {
          // If backend explicitly indicates failure, treat as error
          if (res && res.success === false) {
            const backendMessage: string | undefined = res?.error?.message;
            const message =
              backendMessage ||
              this.translateService.instant('AUTH.LOGIN_ERROR');
            this.errorMessage.next(message);
            this.toastService.presentErrorToast('bottom', message);
            return;
          }

          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('AUTH.LOGIN_SUCCESS')
          );
        },
        error: (error) => {
          const backendMessage: string | undefined =
            error?.error?.error?.message || error?.error?.message;
          let fallbackKey = 'AUTH.LOGIN_ERROR';

          if (error?.status === 401) {
            fallbackKey = 'AUTH.INVALID_CREDENTIALS';
          } else if (error?.status === 0) {
            fallbackKey = 'AUTH.NETWORK_ERROR';
          } else if (error?.status >= 500) {
            fallbackKey = 'AUTH.SERVER_ERROR';
          }

          const message =
            backendMessage || this.translateService.instant(fallbackKey);
          this.errorMessage.next(message);
          this.toastService.presentErrorToast('bottom', message);
        },
      });
  }

  toggleLanguage(): void {
    this.translationService?.setLanguage(this.currentLang === 'ar' ? 'en' : 'ar');
    this.cdr.markForCheck();
  }
}
