import { Routes } from '@angular/router';

import { APPLICATION_ROUTES } from './features/prototype/prototype-routes';

/**
 * App Launcher at the root; one shell per application (no global sidebar). The domains
 * of an application (Comptabilité › Trésorerie…) are routes of that application, never
 * applications of their own. Screens not built yet show a placeholder.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Applications',
    loadComponent: () => import('./features/launcher/launcher').then((m) => m.AlcoLauncher),
  },
  {
    path: 'design-system',
    title: 'Catalogue du design system',
    loadComponent: () =>
      import('./features/design-system/catalog').then((m) => m.DesignSystemCatalogPage),
  },
  ...APPLICATION_ROUTES,
  {
    path: '**',
    title: 'Page introuvable',
    loadComponent: () => import('./core/layout/not-found/not-found').then((m) => m.NotFoundPage),
  },
];
