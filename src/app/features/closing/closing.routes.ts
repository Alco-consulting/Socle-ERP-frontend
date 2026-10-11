import { Routes } from '@angular/router';

/**
 * Comptabilité › Clôture on the API: the closings of the company and one closing with its
 * steps, periods and reopenings. Paths are relative to Comptabilité; the menu link checks
 * `closing.read`, each command its own permission on the server.
 */
export const CLOSING_ROUTES: Routes = [
  {
    path: 'cloture',
    data: { breadcrumb: 'Clôture' },
    children: [
      {
        path: '',
        loadComponent: () => import('./closing-list').then((m) => m.ClosingListPage),
      },
      {
        path: ':id',
        // Named after what it closes once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Clôture' },
        loadComponent: () => import('./closing-run').then((m) => m.ClosingRunPage),
      },
    ],
  },
];
