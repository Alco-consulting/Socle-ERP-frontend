import { Routes } from '@angular/router';

import { APPLICATIONS } from '../../core/navigation/applications';
import { PARTNER_ROUTES } from '../partners/partners.routes';
import { applicationRoute } from './placeholder-routes';

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
  // Real screens (Module 3), on the API.
  partners: PARTNER_ROUTES,
};

/**
 * PROTOTYPE — one shell per application of the catalogue. There is no route for an
 * « Import / Export » application: imports and exports live in their domains.
 */
export const APPLICATION_ROUTES: Routes = APPLICATIONS.map((app) =>
  applicationRoute(app, SCREENS[app.id] ?? []),
);
