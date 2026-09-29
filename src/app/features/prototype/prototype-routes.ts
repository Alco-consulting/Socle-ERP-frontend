import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { APPLICATIONS } from '../../core/navigation/applications';
import { applicationRoute } from './placeholder-routes';

const partnerList = () => import('./partners/partner-list').then((m) => m.PartnerListPage);
const contextualImport = () =>
  import('./transfers/contextual-import').then((m) => m.ContextualImportPage);

/** A partner list and its contextual import (« Tiers › Clients › Import de tiers »). */
function partnerScreen(path: string, label: string, role: 'all' | 'customer' | 'supplier') {
  return {
    path,
    data: { breadcrumb: label, demo: true },
    children: [
      { path: '', data: { role }, loadComponent: partnerList },
      {
        path: 'import',
        data: { breadcrumb: 'Import de tiers', transferKind: 'partners' },
        canActivate: [permissionGuard('imports_exports.create', 'partners.create')],
        loadComponent: contextualImport,
      },
    ],
  };
}

/**
 * Screens built by the prototype, per application; every other screen is a placeholder.
 * `demo: true`: fictitious data, said by the demonstration strip (prototype-banner.ts).
 */
const SCREENS: Readonly<Record<string, Routes>> = {
  accounting: [
    {
      path: 'tableau-de-bord',
      data: { breadcrumb: 'Tableau de bord', demo: true },
      loadComponent: () =>
        import('./accounting/dashboard/accounting-dashboard').then(
          (m) => m.AccountingDashboardPage,
        ),
    },
    {
      path: 'ecritures',
      data: { breadcrumb: 'Écritures', demo: true },
      loadChildren: () => import('./accounting/entries.routes').then((m) => m.ENTRY_ROUTES),
    },
  ],
  partners: [
    partnerScreen('liste', 'Tous les tiers', 'all'),
    partnerScreen('clients', 'Clients', 'customer'),
    partnerScreen('fournisseurs', 'Fournisseurs', 'supplier'),
    {
      path: 'nouveau',
      data: { breadcrumb: 'Nouveau tiers' },
      canActivate: [permissionGuard('partners.create')],
      loadComponent: () =>
        import('./not-in-prototype/not-in-prototype').then((m) => m.NotInPrototypePage),
    },
  ],
};

/**
 * PROTOTYPE — one shell per application of the catalogue. There is no route for an
 * « Import / Export » application: imports and exports live in their domains.
 */
export const APPLICATION_ROUTES: Routes = APPLICATIONS.map((app) =>
  applicationRoute(app, SCREENS[app.id] ?? []),
);
