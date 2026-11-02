import { Routes } from '@angular/router';
import { GuestGuard } from 'src/app/core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    canActivate: [GuestGuard],
    loadComponent: () => import('./components').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    canActivate: [GuestGuard],
    loadComponent: () => import('./components').then((m) => m.SignupComponent),
  },
  {
    path: 'callback',
    loadComponent: () =>
      import('./pages/auth-callback/auth-callback.component').then(
        (m) => m.AuthCallbackComponent
      ),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/password-recovery.component').then(
        (m) => m.ForgotPasswordComponent
      ),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/password-recovery.component').then(
        (m) => m.ResetPasswordComponent
      ),
  },
];
