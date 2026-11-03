import { Routes } from '@angular/router';
import { AuthGuard, AuthGuardService } from './core/guards/auth.guard';
import { APP_ROUTES } from './core/constants';

export const routes: Routes = [
  {
    path: '',
    redirectTo: APP_ROUTES.HOME,
    pathMatch: 'full',
  },
  {
    path: APP_ROUTES.HOME,
    loadChildren: () => import('./home/home.routes').then((m) => m.routes),
    // Home is public; it contains CTAs to sign in
  },
  {
    path: APP_ROUTES.AUTH.INDEX,
    loadChildren: () =>
      import('./modules/auth/auth.routes').then((m) => m.routes),
  },
  {
    path: APP_ROUTES.CATEGORIES.INDEX,
    loadChildren: () =>
      import('./modules/categories/categories.routes').then((m) => m.routes),
    canActivate: [AuthGuard],
    canLoad: [AuthGuardService],
  },
  {
    path: APP_ROUTES.PROFILE.INDEX,
    loadChildren: () =>
      import('./modules/profile/profile.routes').then((m) => m.routes),
    canActivate: [AuthGuard],
    canLoad: [AuthGuardService],
  },
  {
    path: APP_ROUTES.TRANSACTIONS.INDEX,
    loadChildren: () =>
      import('./modules/transactions/transactions.routes').then(
        (m) => m.routes
      ),
    canActivate: [AuthGuard],
    canLoad: [AuthGuardService],
  },
  {
    path: APP_ROUTES.VAULT.INDEX,
    loadChildren: () =>
      import('./modules/vault/vault.routes').then((m) => m.routes),
    canActivate: [AuthGuard],
    canLoad: [AuthGuardService],
  },
  {
    path: APP_ROUTES.SETTINGS.INDEX,
    loadChildren: () =>
      import('./modules/settings/settings.routes').then((m) => m.routes),
    canActivate: [AuthGuard],
    canLoad: [AuthGuardService],
  },
  {
    path: 'help',
    loadChildren: () =>
      import('./modules/help/help.routes').then((m) => m.routes),
  },
  {
    path: 'subscription',
    loadComponent: () =>
      import('./modules/subscription/subscription.page').then(
        (m) => m.SubscriptionPage
      ),
    canActivate: [AuthGuard],
    canLoad: [AuthGuardService],
  },
  {
    path: 'legal',
    loadChildren: () =>
      import('./modules/legal/legal.routes').then((m) => m.routes),
  },
  {
    path: 'notifications',
    loadChildren: () =>
      import('./modules/notifications/notifications.routes').then(
        (m) => m.routes
      ),
    canActivate: [AuthGuard],
    canLoad: [AuthGuardService],
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full',
  },
];
