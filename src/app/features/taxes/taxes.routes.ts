import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const taxForm = () => import('./tax-form').then((m) => m.TaxFormPage);

/**
 * Comptabilité › Taxes (Configuration › Taxes) on the API, as Odoo's screens: the list, a
 * tax and its form. Paths are relative to Comptabilité and start with the section's
 * (`taxes/…`): they are served among the section's routes (placeholder-routes.ts). The
 * section's guard checks `taxes.read`; the forms check their own permission.
 */
export const TAXES_ROUTES: Routes = [
  {
    path: 'taxes/liste',
    data: { breadcrumb: 'Taxes' },
    children: [
      { path: '', loadComponent: () => import('./tax-list').then((m) => m.TaxListPage) },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouvelle taxe' },
        canActivate: [permissionGuard('taxes.create')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: taxForm,
      },
      {
        path: ':id',
        // Named after the tax once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Taxe' },
        children: [
          { path: '', loadComponent: () => import('./tax-detail').then((m) => m.TaxDetailPage) },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard('taxes.update')],
            canDeactivate: [unsavedChangesGuard],
            loadComponent: taxForm,
          },
        ],
      },
    ],
  },
];
