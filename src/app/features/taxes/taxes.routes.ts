import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const taxForm = () => import('./tax-form').then((m) => m.TaxFormPage);

/**
 * Comptabilité › Taxes (Configuration › Taxes) on the API: the list and one simple page per
 * tax, to create it or change it. Paths are relative to Comptabilité and start with the
 * section's (`taxes/…`): they are served among the section's routes (placeholder-routes.ts).
 * The section's guard checks `taxes.read`; creating checks `taxes.create`; without
 * `taxes.update` a tax's page is read only.
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
        canDeactivate: [unsavedChangesGuard],
        loadComponent: taxForm,
      },
    ],
  },
  // VAT declarations (note backend 0059): computed by the server from the posted entries.
  {
    path: 'taxes/declarations',
    data: { breadcrumb: 'Déclarations' },
    children: [
      {
        path: '',
        loadComponent: () => import('./declaration-list').then((m) => m.DeclarationListPage),
      },
      {
        path: ':id',
        // Named after its period once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Déclaration' },
        loadComponent: () => import('./declaration-detail').then((m) => m.DeclarationDetailPage),
      },
    ],
  },
];
