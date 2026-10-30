import { Routes } from '@angular/router';
import { APP_ROUTES } from 'src/app/core/constants';

export const routes: Routes = [
  {
    path: 'sessions',
    loadComponent: () =>
      import('./sessions/sessions.page').then((m) => m.SessionsPage),
  },
  {
    path: '',
    redirectTo: APP_ROUTES.SETTINGS.LIST,
    pathMatch: 'full',
  },
  {
    path: APP_ROUTES.SETTINGS.LIST,
    loadComponent: () =>
      import('./list/settings-list.component').then(
        (m) => m.SettingsListComponent
      ),
  },
  {
    path: APP_ROUTES.SETTINGS.SYNC,
    loadComponent: () =>
      import('./sync/pages/sync-settings/sync-settings.page').then(
        (m) => m.SyncSettingsPage
      ),
  },
  {
    path: APP_ROUTES.SETTINGS.CONFLICTS,
    loadComponent: () =>
      import('./sync/pages/conflict-resolution/conflict-resolution.page').then(
        (m) => m.ConflictResolutionPage
      ),
  },
  {
    path: APP_ROUTES.SETTINGS.BACKUP,
    loadComponent: () =>
      import('./backup/backup.page').then((m) => m.BackupSettingsPage),
  },
  {
    path: APP_ROUTES.SETTINGS.EXPORT,
    loadComponent: () =>
      import('./export/data-export.page').then((m) => m.DataExportPage),
  },
  {
    path: APP_ROUTES.SETTINGS.NOTIFICATION_PREFERENCES,
    loadComponent: () =>
      import('./notification-preferences/notification-preferences.page').then(
        (m) => m.NotificationPreferencesPage
      ),
  },
  {
    path: APP_ROUTES.SETTINGS.DELETE_ACCOUNT,
    loadComponent: () =>
      import('./delete-account/delete-account.page').then(
        (m) => m.DeleteAccountPage
      ),
  },
];
