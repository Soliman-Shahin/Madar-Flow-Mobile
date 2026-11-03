import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/vault-page/vault-page.component').then((m) => m.VaultPageComponent),
    data: { title: 'VAULT.TITLE' },
  },
];
