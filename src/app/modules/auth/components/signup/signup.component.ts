import { Component, ChangeDetectionStrategy, OnInit } from '@angular/core';
import {
  AbstractControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { IonicModule } from '@ionic/angular';
import { UiInputComponent } from '../../../../shared/ui/ui-input/ui-input.component';
import { RouterLink } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { CONSENT_VERSIONS } from 'src/app/config/consent.config';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss'],
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
export class SignupComponent extends BaseComponent implements OnInit {
  signupForm!: FormGroup;
  hidePassword = true;
  hideConfirmPassword = true;
  isSubmitted = false;

  private readonly loading = new BehaviorSubject<boolean>(false);
  private readonly errorMessage = new BehaviorSubject<string>('');

  readonly vm$ = combineLatest({
    isLoading: this.loading.asObservable(),
    errorMessage: this.errorMessage.asObservable(),
  });
  passwordStrength = 0;
  passwordStrengthMessage = '';
  // Make redirectUrl public for template access
  public redirectUrl: string | null = null;

  // Form control names for template access
  readonly formFields = {
    name: 'name',
    email: 'email',
    password: 'password',
    confirmPassword: 'confirmPassword',
    termsAccepted: 'termsAccepted',
  };

  constructor() {
    super();
  }

  // Initialize component
  override ngOnInit(): void {
    this.initForm();
    this.setupPasswordStrengthChecker();
    this.redirectUrl =
      this.activatedRoute.snapshot.queryParams['redirect'] || null;
  }

  togglePasswordVisibility(field: 'password' | 'confirmPassword'): void {
    if (field === 'password') {
      this.hidePassword = !this.hidePassword;
    } else {
      this.hideConfirmPassword = !this.hideConfirmPassword;
    }
  }

  private initForm(): void {
    this.signupForm = this.fb.group(
      {
        [this.formFields.name]: [
          '',
          [
            Validators.required,
            Validators.minLength(2),
            Validators.maxLength(50),
            Validators.pattern(/^[\p{L}\s'-]+$/u),
          ],
        ],
        [this.formFields.email]: [
          '',
          [Validators.required, Validators.email, Validators.maxLength(100)],
        ],
        [this.formFields.password]: [
          '',
          [
            Validators.required,
            Validators.minLength(8),
            Validators.maxLength(50),
            this.passwordStrengthValidator(),
          ],
        ],
        [this.formFields.confirmPassword]: ['', [Validators.required]],
        [this.formFields.termsAccepted]: [false, [Validators.requiredTrue]],
      },
      { validators: [this.passwordMatchValidator] }
    );
  }

  // Setup password strength checker
  private setupPasswordStrengthChecker(): void {
    this.signupForm
      .get(this.formFields.password)
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((password) => {
        if (!password) {
          this.passwordStrength = 0;
          this.passwordStrengthMessage = '';
          return;
        }

        let strength = 0;
        const messages: string[] = [];

        // Length check
        if (password.length >= 8) strength += 1;
        if (password.length >= 12) strength += 1;

        // Complexity checks
        if (/[0-9]/.test(password)) strength += 1;
        if (/[a-z]/.test(password)) strength += 1;
        if (/[A-Z]/.test(password)) strength += 1;
        if (/[^A-Za-z0-9]/.test(password)) strength += 1;

        // Calculate strength percentage (0-100)
        this.passwordStrength = Math.min(100, Math.round((strength / 6) * 100));

        // Set strength message
        if (password.length < 8) {
          this.passwordStrengthMessage = this.translateService.instant(
            'AUTH.PASSWORD_TOO_SHORT'
          );
        } else if (this.passwordStrength < 50) {
          this.passwordStrengthMessage =
            this.translateService.instant('AUTH.PASSWORD_WEAK');
        } else if (this.passwordStrength < 75) {
          this.passwordStrengthMessage =
            this.translateService.instant('AUTH.PASSWORD_GOOD');
        } else {
          this.passwordStrengthMessage = this.translateService.instant(
            'AUTH.PASSWORD_STRONG'
          );
        }
      });
  }

  // Custom validator for password strength
  private passwordStrengthValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value || '';
      if (!value) return null;

      const hasNumber = /[0-9]/.test(value);
      const hasUpper = /[A-Z]/.test(value);
      const hasLower = /[a-z]/.test(value);
      const hasSpecial = /[^A-Za-z0-9]/.test(value);

      const errors: ValidationErrors = {};

      if (!hasNumber) errors['missingNumber'] = true;
      if (!hasUpper) errors['missingUpper'] = true;
      if (!hasLower) errors['missingLower'] = true;
      if (!hasSpecial) errors['missingSpecial'] = true;

      return Object.keys(errors).length > 0 ? errors : null;
    };
  }

  // Custom validator for password confirmation
  private passwordMatchValidator: ValidatorFn = (
    control: AbstractControl
  ): ValidationErrors | null => {
    const formGroup = control as FormGroup;
    const password = formGroup.get(this.formFields.password)?.value;
    const confirmPassword = formGroup.get(
      this.formFields.confirmPassword
    )?.value;

    if (!password || !confirmPassword) return null;

    return password === confirmPassword ? null : { passwordMismatch: true };
  };

  // Getters for form controls with type safety
  get name() {
    return this.signupForm.get(this.formFields.name);
  }
  get email() {
    return this.signupForm.get(this.formFields.email);
  }
  get password() {
    return this.signupForm.get(this.formFields.password);
  }
  get confirmPassword() {
    return this.signupForm.get(this.formFields.confirmPassword);
  }
  get termsAccepted() {
    return this.signupForm.get(this.formFields.termsAccepted);
  }

  // Alias getters for template compatibility
  get emailControl() {
    return this.email;
  }
  get passwordControl() {
    return this.password;
  }
  get confirmPasswordControl() {
    return this.confirmPassword;
  }

  // Check if field has error
  controlHasError(controlName: string, errorName: string): boolean {
    const control = this.signupForm.get(controlName);
    return control
      ? control.hasError(errorName) &&
          (control.dirty || control.touched || this.isSubmitted)
      : false;
  }

  signInWithGoogle(): void {
    if (!this.termsAccepted?.value) {
      this.isSubmitted = true;
      this.signupForm.markAllAsTouched();
      return;
    }
    this.loading.next(true);
    this.authService
      .loginWithGoogle({
        termsAccepted: true,
        privacyAccepted: true,
        ...CONSENT_VERSIONS,
      })
      .pipe(
        finalize(() => this.loading.next(false)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        error: (error) =>
          this.errorMessage.next(
            error?.error?.message ||
              this.translateService.instant('AUTH.SIGNUP_ERROR')
          ),
      });
  }

  // Open terms and conditions
  openTerms(): void {
    void this.router.navigateByUrl('/legal/terms');
  }

  // Open privacy policy
  openPrivacyPolicy(): void {
    void this.router.navigateByUrl('/legal/privacy');
  }

  // Handle form submission
  signup(): void {
    this.isSubmitted = true;

    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      return;
    }

    this.loading.next(true);
    this.errorMessage.next('');

    const { email, password } = this.signupForm.value;

    this.authService
      .signup(email, password, {
        termsAccepted: true,
        privacyAccepted: true,
        ...CONSENT_VERSIONS,
      })
      .pipe(
        finalize(() => this.loading.next(false)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('AUTH.SIGNUP_SUCCESS')
          );

          // Redirect to login or the intended URL
          const redirectUrl = this.redirectUrl || '/home';
          this.router.navigateByUrl(redirectUrl, { replaceUrl: true });
        },
        error: (error) => {
          console.error('Signup error:', error);

          let errorKey = 'AUTH.SIGNUP_ERROR';

          // Handle specific error cases
          if (error.code === 'auth/email-already-in-use') {
            errorKey = 'AUTH.EMAIL_ALREADY_EXISTS';
          } else if (error.code === 'auth/invalid-email') {
            errorKey = 'AUTH.INVALID_EMAIL';
          } else if (error.code === 'auth/weak-password') {
            errorKey = 'AUTH.WEAK_PASSWORD';
          } else if (error.status === 400) {
            // Handle HTTP 400 errors
            errorKey = 'AUTH.EMAIL_ALREADY_EXISTS';
          } else if (error.status === 0) {
            // Handle network errors
            errorKey = 'AUTH.NETWORK_ERROR';
          } else if (error.status >= 500) {
            // Handle server errors
            errorKey = 'AUTH.SERVER_ERROR';
          }

          const errorMessage = this.translateService.instant(errorKey);
          this.errorMessage.next(errorMessage);
          this.toastService.presentErrorToast('bottom', errorMessage);
        },
      });
  }

  toggleLanguage(): void {
    this.translationService?.setLanguage(this.currentLang === 'ar' ? 'en' : 'ar');
    this.cdr.markForCheck();
  }
}
