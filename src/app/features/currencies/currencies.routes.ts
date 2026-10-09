import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const currencyForm = () => import('./currency-form').then((m) => m.CurrencyFormPage);

/**
 * Comptabilité › Configuration › Devises on the API, as Odoo shows them: the list of the
 * shared catalogue and one page per currency with its « Taux » in the active company. Paths
 * are relative to Comptabilité. The menu link checks `currencies.read`; creating checks the
 * global `currencies.create`; without `currencies.update` a currency's page is read only (its
 * rates still follow `currencies.manage_rates`).
 */
export const CURRENCIES_ROUTES: Routes = [
  {
    path: 'configuration/devises',
    data: { breadcrumb: 'Devises' },
    children: [
      {
        path: '',
        loadComponent: () => import('./currency-list').then((m) => m.CurrencyListPage),
      },
      {
        path: 'nouvelle',
        data: { breadcrumb: 'Nouvelle devise' },
        canActivate: [permissionGuard('currencies.create')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: currencyForm,
      },
      {
        path: ':id',
        // Named after the currency's code once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Devise' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: currencyForm,
      },
    ],
  },
];
