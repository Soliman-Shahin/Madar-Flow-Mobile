import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, finalize } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { BiometricSignInService } from '../services/biometric-signin.service';
import { BRAND } from 'src/app/config/brand.config';

const same = (control: AbstractControl): ValidationErrors | null =>
  control.get('password')?.value === control.get('confirm')?.value
    ? null
    : { mismatch: true };

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [IonicModule, ReactiveFormsModule, RouterLink, TranslateModule],
  template: `<ion-content class="mf-auth-content">
    <main class="mf-auth">
      <div class="mf-auth__top">
        <a
          routerLink="/auth/login"
          class="mf-auth__back"
          [attr.aria-label]="'AUTH.BACK_TO_LOGIN' | translate"
          ><ion-icon name="chevron-back" aria-hidden="true"></ion-icon
        ></a>
      </div>
      <header class="mf-auth__heading">
        <h1>{{ 'AUTH.RECOVERY_TITLE' | translate }}</h1>
        <p>{{ 'AUTH.RECOVERY_SUBTITLE' | translate }}</p>
      </header>
      @if (sent()) {
      <p class="mf-auth__notice" role="status">
        <ion-icon name="mail-unread-outline" aria-hidden="true"></ion-icon>
        <span>{{ 'AUTH.RECOVERY_GENERIC' | translate }}</span>
      </p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="mf-auth__form">
        <label class="mf-auth__label" for="recovery-email">{{
          'AUTH.EMAIL' | translate
        }}</label>
        <ion-item lines="none" class="form-input-item">
          <ion-icon
            slot="start"
            name="mail-outline"
            aria-hidden="true"
          ></ion-icon>
          <ion-input
            id="recovery-email"
            type="email"
            inputmode="email"
            autocomplete="email"
            formControlName="email"
            [placeholder]="'AUTH.EMAIL_PLACEHOLDER' | translate"
          ></ion-input>
        </ion-item>
        <ion-button
          expand="block"
          type="submit"
          class="mf-auth__primary"
          [disabled]="form.invalid || loading()"
        >
          @if (loading()) {
          <ion-spinner name="crescent" aria-hidden="true"></ion-spinner>
          } @else {
          {{ 'AUTH.SEND_RESET' | translate }}
          }
        </ion-button>
      </form>
      <p class="mf-auth__switch">
        <a routerLink="/auth/login" class="mf-auth__link">{{
          'AUTH.BACK_TO_LOGIN' | translate
        }}</a>
      </p>
    </main>
  </ion-content>`,
  styles: [
    `
      ion-content.mf-auth-content {
        --background: var(--mf-bg);
        --color: var(--mf-ink);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordComponent {
  readonly brand = BRAND;
  private auth = inject(AuthService);
  form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
  });
  private loadingState = new BehaviorSubject(false);
  private sentState = new BehaviorSubject(false);
  loading = () => this.loadingState.value;
  sent = () => this.sentState.value;
  submit() {
    if (this.form.invalid) return;
    this.loadingState.next(true);
    this.auth
      .requestPasswordReset(this.form.value.email!)
      .pipe(finalize(() => this.loadingState.next(false)))
      .subscribe({
        next: () => this.sentState.next(true),
        error: () => this.sentState.next(true),
      });
  }
}

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [IonicModule, ReactiveFormsModule, RouterLink, TranslateModule],
  template: `<ion-content class="mf-auth-content">
    <main class="mf-auth">
      <div class="mf-auth__top">
        <a
          routerLink="/auth/login"
          class="mf-auth__back"
          [attr.aria-label]="'AUTH.BACK_TO_LOGIN' | translate"
          ><ion-icon name="chevron-back" aria-hidden="true"></ion-icon
        ></a>
      </div>
      <header class="mf-auth__heading">
        <h1>{{ 'AUTH.RESET_PASSWORD' | translate }}</h1>
      </header>
      @if (!token) {
      <p class="mf-auth__error" role="alert">
        <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
        <span>{{ 'AUTH.RESET_INVALID' | translate }}</span>
      </p>
      } @else if (done()) {
      <p class="mf-auth__notice" role="status">
        <ion-icon name="checkmark-circle-outline" aria-hidden="true"></ion-icon>
        <span>{{ 'AUTH.RESET_SUCCESS' | translate }}</span>
      </p>
      } @else if (error()) {
      <p class="mf-auth__error" role="alert">
        <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
        <span>{{ 'AUTH.RESET_INVALID' | translate }}</span>
      </p>
      } @else {
      <form [formGroup]="form" (ngSubmit)="submit()" class="mf-auth__form">
        <label class="mf-auth__label" for="reset-password">{{
          'AUTH.NEW_PASSWORD' | translate
        }}</label>
        <ion-item lines="none" class="form-input-item">
          <ion-icon
            slot="start"
            name="lock-closed-outline"
            aria-hidden="true"
          ></ion-icon>
          <ion-input
            id="reset-password"
            type="password"
            autocomplete="new-password"
            formControlName="password"
            [placeholder]="'AUTH.NEW_PASSWORD' | translate"
          ></ion-input>
        </ion-item>
        <label class="mf-auth__label" for="reset-confirm">{{
          'AUTH.CONFIRM_PASSWORD' | translate
        }}</label>
        <ion-item lines="none" class="form-input-item">
          <ion-icon
            slot="start"
            name="shield-checkmark-outline"
            aria-hidden="true"
          ></ion-icon>
          <ion-input
            id="reset-confirm"
            type="password"
            autocomplete="new-password"
            formControlName="confirm"
            [placeholder]="'AUTH.CONFIRM_PASSWORD' | translate"
          ></ion-input>
        </ion-item>
        @if (form.hasError('mismatch')) {
        <p class="mf-auth__error" role="alert">
          <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'AUTH.PASSWORD_MISMATCH' | translate }}</span>
        </p>
        }
        <ion-button
          expand="block"
          type="submit"
          class="mf-auth__primary"
          [disabled]="form.invalid || loading()"
        >
          @if (loading()) {
          <ion-spinner name="crescent" aria-hidden="true"></ion-spinner>
          } @else {
          {{ 'AUTH.RESET_PASSWORD' | translate }}
          }
        </ion-button>
      </form>
      }
      <p class="mf-auth__switch">
        <a routerLink="/auth/login" class="mf-auth__link">{{
          'AUTH.BACK_TO_LOGIN' | translate
        }}</a>
      </p>
    </main>
  </ion-content>`,
  styles: [
    `
      ion-content.mf-auth-content {
        --background: var(--mf-bg);
        --color: var(--mf-ink);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordComponent {
  readonly brand = BRAND;
  private auth = inject(AuthService);
  private biometricSignIn = inject(BiometricSignInService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  token = this.route.snapshot.queryParamMap.get('token');
  private loadingState = new BehaviorSubject(false);
  private doneState = new BehaviorSubject(false);
  private errorState = new BehaviorSubject(false);
  loading = () => this.loadingState.value;
  done = () => this.doneState.value;
  error = () => this.errorState.value;
  form = new FormGroup(
    {
      password: new FormControl('', [
        Validators.required,
        Validators.minLength(6),
      ]),
      confirm: new FormControl('', Validators.required),
    },
    { validators: same }
  );
  submit() {
    if (!this.token || this.form.invalid) return;
    this.loadingState.next(true);
    this.auth
      .resetPassword(this.token, this.form.value.password!)
      .pipe(finalize(() => this.loadingState.next(false)))
      .subscribe({
        next: () => {
          void this.biometricSignIn.clearLocalEnrollment();
          this.doneState.next(true);
          void this.router.navigateByUrl('/auth/login');
        },
        error: () => this.errorState.next(true),
      });
  }
}
