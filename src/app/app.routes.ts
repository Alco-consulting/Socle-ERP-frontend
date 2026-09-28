import { Routes } from '@angular/router';

import { AlcoModuleShell } from './core/layout/module-shell/module-shell';
import { appAccessGuard } from './core/navigation/app-access.guard';
import { APPLICATIONS } from './core/navigation/applications';
import { placeholderApplication } from './features/prototype/placeholder-routes';

/**
 * App Launcher at the root; one shell per application (no global sidebar).
 * Only « Comptabilité » has prototype screens; the other applications show their real
 * navigation over placeholder screens until their module is built.
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
  {
    path: 'comptabilite',
    component: AlcoModuleShell,
    data: { appId: 'accounting' },
    canActivate: [appAccessGuard],
    loadChildren: () =>
      import('./features/prototype/accounting/accounting.routes').then(
        (m) => m.ACCOUNTING_PROTOTYPE_ROUTES,
      ),
  },
  ...APPLICATIONS.filter((app) => app.id !== 'accounting').map(placeholderApplication),
  {
    path: '**',
    title: 'Page introuvable',
    loadComponent: () => import('./core/layout/not-found/not-found').then((m) => m.NotFoundPage),
  },
];
