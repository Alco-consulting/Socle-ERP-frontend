import { inject } from '@angular/core';
import { ResolveFn, Routes } from '@angular/router';

import { permissionGuard } from '../../../core/navigation/app-access.guard';
import { PrototypeAccountingApi } from './prototype-accounting-api';

/** Breadcrumb of a record: its number (« EC-2026-000145 »). */
const entryNumber: ResolveFn<string> = (route) =>
  inject(PrototypeAccountingApi).numberOf(route.paramMap.get('id') ?? '') ?? 'Écriture introuvable';

/**
 * PROTOTYPE — Comptabilité › Écritures: list, contextual import, new entry, entry.
 * Loaded lazily under `/comptabilite/ecritures`.
 */
export const ENTRY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./entry-list/entry-list').then((m) => m.EntryListPage),
  },
  {
    path: 'import',
    data: { breadcrumb: 'Import d’écritures', transferKind: 'entries' },
    canActivate: [permissionGuard('imports_exports.create', 'accounting.create')],
    loadComponent: () =>
      import('../transfers/contextual-import').then((m) => m.ContextualImportPage),
  },
  {
    path: 'nouvelle',
    data: { breadcrumb: 'Nouvelle écriture' },
    canActivate: [permissionGuard('accounting.create')],
    loadComponent: () => import('./entry-form/entry-form').then((m) => m.EntryFormPage),
  },
  {
    path: ':id',
    resolve: { breadcrumb: entryNumber },
    runGuardsAndResolvers: 'always',
    loadComponent: () => import('./entry-form/entry-form').then((m) => m.EntryFormPage),
  },
];
