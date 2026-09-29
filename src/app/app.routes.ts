import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';
import { APPLICATION_ROUTES } from './features/prototype/prototype-routes';

/**
 * - `/login`: public (anonymous visitors);
 * - `/app`: the authenticated area — App Launcher, then one shell per application
 *   (`/app/comptabilite/…`), no global sidebar; every screen is lazy-loaded;
 * - `/design-system`: the living catalogue;
 * - `/` goes to `/app`.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  {
    path: 'login',
    title: 'Connexion',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.LoginPage),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Applications',
        loadComponent: () => import('./features/launcher/launcher').then((m) => m.AlcoLauncher),
      },
      ...APPLICATION_ROUTES,
    ],
  },
  {
    path: 'design-system',
    title: 'Catalogue du design system',
    loadComponent: () =>
      import('./features/design-system/catalog').then((m) => m.DesignSystemCatalogPage),
  },
  {
    path: '**',
    title: 'Page introuvable',
    loadComponent: () => import('./core/layout/not-found/not-found').then((m) => m.NotFoundPage),
  },
];
