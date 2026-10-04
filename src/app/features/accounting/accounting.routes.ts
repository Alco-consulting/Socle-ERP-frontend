import { Route, Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const dashboard = () =>
  import('./dashboard/accounting-dashboard').then((m) => m.AccountingDashboardPage);
const fiscalYears = () => import('./periods/fiscal-years').then((m) => m.FiscalYearsPage);
const ledger = () => import('../reporting/ledger/ledger-page').then((m) => m.LedgerPage);

/** A referential list with its creation, record and modification (manage permission). */
function referential(
  path: string,
  label: string,
  newLabel: string,
  recordLabel: string,
  permission: string,
  screens: {
    list: Route['loadComponent'];
    detail: Route['loadComponent'];
    form: Route['loadComponent'];
  },
): Route {
  return {
    path,
    data: { breadcrumb: label },
    children: [
      { path: '', loadComponent: screens.list },
      {
        path: 'nouveau',
        data: { breadcrumb: newLabel },
        canActivate: [permissionGuard(permission)],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: screens.form,
      },
      {
        path: ':id',
        // Named after the record once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: recordLabel },
        children: [
          { path: '', loadComponent: screens.detail },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard(permission)],
            canDeactivate: [unsavedChangesGuard],
            loadComponent: screens.form,
          },
        ],
      },
    ],
  };
}

/**
 * Comptabilité on the API: dashboard (journals and alerts of `dashboards/`, V2.1), entries
 * (Module 5), journals, chart of accounts, fiscal years and periods (Module 4). Treasury,
 * Analyse and the other domains are still planned screens.
 */
export const ACCOUNTING_ROUTES: Routes = [
  // dashboards.read is the menu link's (catalogue): the screen guard checks it.
  { path: 'tableau-de-bord', data: { breadcrumb: 'Tableau de bord' }, loadComponent: dashboard },
  {
    path: 'ecritures',
    data: { breadcrumb: 'Écritures' },
    loadChildren: () => import('./entries/entry.routes').then((m) => m.ENTRY_ROUTES),
  },
  referential('journaux', 'Journaux', 'Nouveau journal', 'Journal', 'accounting.manage_journals', {
    list: () => import('./journals/journal-list').then((m) => m.JournalListPage),
    detail: () => import('./journals/journal-detail').then((m) => m.JournalDetailPage),
    form: () => import('./journals/journal-form').then((m) => m.JournalFormPage),
  }),
  referential(
    'plan-comptable',
    'Plan comptable',
    'Nouveau compte',
    'Compte',
    'accounting.manage_accounts',
    {
      list: () => import('./accounts/account-list').then((m) => m.AccountListPage),
      detail: () => import('./accounts/account-detail').then((m) => m.AccountDetailPage),
      form: () => import('./accounts/account-form').then((m) => m.AccountFormPage),
    },
  ),
  // Analyse: one ledger experience on Reporting (account, or partner: route data `ledger`).
  {
    path: 'analyse/grand-livre',
    data: { breadcrumb: 'Grand livre', ledger: 'account' },
    loadComponent: ledger,
  },
  {
    path: 'analyse/grand-livre-auxiliaire',
    data: { breadcrumb: 'Grand livre auxiliaire', ledger: 'partner' },
    loadComponent: ledger,
  },
  {
    path: 'configuration/exercices',
    data: { breadcrumb: 'Exercices et périodes' },
    loadComponent: fiscalYears,
  },
];
