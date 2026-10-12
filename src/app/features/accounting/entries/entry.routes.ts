import { Routes } from '@angular/router';

import { permissionGuard } from '../../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../../core/navigation/unsaved-changes';
import { ENTRY_TRANSFER } from './entry-presentation';

const form = () => import('./entry-form').then((m) => m.EntryFormPage);

/** Comptabilité › Écritures: the lines, the pieces, a record and its form (note backend 0039). */
export const ENTRY_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./entry-lines').then((m) => m.EntryLinesPage) },
  {
    path: 'pieces',
    data: { breadcrumb: 'Pièces comptables' },
    loadComponent: () => import('./entry-list').then((m) => m.EntryListPage),
  },
  {
    path: 'import',
    data: { breadcrumb: 'Import d’écritures', transfer: ENTRY_TRANSFER },
    canActivate: [permissionGuard('imports_exports.create', 'accounting.create')],
    loadComponent: () =>
      import('../../transfers/import-page/import-page').then((m) => m.ImportPage),
  },
  {
    path: 'nouvelle',
    data: { breadcrumb: 'Nouvelle écriture' },
    canActivate: [permissionGuard('accounting.create')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: form,
  },
  {
    path: ':id',
    // Named after the entry once loaded (BreadcrumbService.nameCurrent).
    data: { breadcrumb: 'Écriture' },
    children: [
      { path: '', loadComponent: () => import('./entry-detail').then((m) => m.EntryDetailPage) },
      {
        path: 'modifier',
        data: { breadcrumb: 'Modifier' },
        canActivate: [permissionGuard('accounting.update')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: form,
      },
    ],
  },
];
