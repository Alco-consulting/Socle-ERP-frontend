import { Route, Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';

const dashboard = () =>
  import('./dashboard/accounting-dashboard').then((m) => m.AccountingDashboardPage);
const fiscalYears = () => import('./periods/fiscal-years').then((m) => m.FiscalYearsPage);

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
            loadComponent: screens.form,
          },
        ],
      },
    ],
  };
}

/**
 * Comptabilité on the API (Module 4, the accounting base): dashboard, journals, chart of
 * accounts, fiscal years and periods. Entries, treasury and the other domains are still
 * screens of the prototype or planned screens.
 */
export const ACCOUNTING_ROUTES: Routes = [
  { path: 'tableau-de-bord', data: { breadcrumb: 'Tableau de bord' }, loadComponent: dashboard },
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
  {
    path: 'configuration/exercices',
    data: { breadcrumb: 'Exercices et périodes' },
    loadComponent: fiscalYears,
  },
];
