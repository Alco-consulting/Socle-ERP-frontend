import { Routes } from '@angular/router';

import { APPLICATIONS } from '../../core/navigation/applications';
import { ACCOUNTING_ROUTES } from '../accounting/accounting.routes';
import { PARTNER_ROUTES } from '../partners/partners.routes';
import { applicationRoute } from './placeholder-routes';

/**
 * Screens built by the prototype, per application; every other screen is a placeholder.
 * `demo: true`: fictitious data, said by the demonstration strip (prototype-banner.ts).
 */
const SCREENS: Readonly<Record<string, Routes>> = {
  // Real screens (Modules 4 and 5), on the API.
  accounting: ACCOUNTING_ROUTES,
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
