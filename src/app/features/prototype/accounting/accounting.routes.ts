import { inject } from '@angular/core';
import { ResolveFn, Routes } from '@angular/router';

import { permissionGuard } from '../../../core/navigation/app-access.guard';
import { findApplication } from '../../../core/navigation/applications';
import { placeholderScreens } from '../placeholder-routes';
import { PrototypeAccountingApi } from './prototype-accounting-api';

/** Breadcrumb of a record: its number (« EC-2026-000145 »). */
const entryNumber: ResolveFn<string> = (route) =>
  inject(PrototypeAccountingApi).numberOf(route.paramMap.get('id') ?? '') ?? 'Écriture introuvable';

const accounting = findApplication('accounting');

/**
 * PROTOTYPE — the accounting application: dashboard, entries (list + form) built on the
 * design system; every other screen of its menu is a placeholder.
 */
export const ACCOUNTING_PROTOTYPE_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tableau-de-bord' },
  {
    path: 'tableau-de-bord',
    data: { breadcrumb: 'Tableau de bord' },
    loadComponent: () =>
      import('./dashboard/accounting-dashboard').then((m) => m.AccountingDashboardPage),
  },
  {
    path: 'ecritures',
    data: { breadcrumb: 'Écritures' },
    children: [
      {
        path: '',
        loadComponent: () => import('./entry-list/entry-list').then((m) => m.EntryListPage),
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
    ],
  },
  ...(accounting ? placeholderScreens(accounting, ['tableau-de-bord', 'ecritures']) : []),
];
