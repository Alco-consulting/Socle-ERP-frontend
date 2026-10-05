import { Route, Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const dashboard = () =>
  import('./dashboard/accounting-dashboard').then((m) => m.AccountingDashboardPage);
const fiscalYears = () => import('./periods/fiscal-years').then((m) => m.FiscalYearsPage);
const ledger = () => import('../reporting/ledger/ledger-page').then((m) => m.LedgerPage);

/** An aged balance (`data.aging`: the role) and one partner of it. */
function agedBalance(path: string, label: string, role: 'customer' | 'supplier'): Route {
  return {
    path,
    data: { breadcrumb: label, aging: role },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('../reporting/aging/aged-balance-page').then((m) => m.AgedBalancePage),
      },
      {
        path: ':id',
        // Named after the partner once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Tiers' },
        loadComponent: () =>
          import('../reporting/aging/aged-partner-page').then((m) => m.AgedPartnerPage),
      },
    ],
  };
}

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
 * (Module 5), lettering (V2.1 A4), due dates and aged balance (V2.1 A5), journals, chart of
 * accounts, fiscal years and periods (Module 4), bank reconciliation (V2.1 A6). The rest of
 * Treasury, Analyse and the other domains are still planned screens.
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
  // Lettering (V2.1 A4): lines, proposals, letterings; a lettering's record.
  {
    path: 'lettrage',
    data: { breadcrumb: 'Lettrage' },
    children: [
      {
        path: '',
        loadComponent: () => import('./lettering/lettering-page').then((m) => m.LetteringPage),
      },
      {
        path: ':id',
        // Named after the lettering once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Lettrage' },
        loadComponent: () =>
          import('./lettering/lettering-detail').then((m) => m.LetteringDetailPage),
      },
    ],
  },
  // Due dates (V2.1 A5): installments and pending invoices; an installment, a schedule.
  {
    path: 'echeances',
    data: { breadcrumb: 'Échéances' },
    children: [
      { path: '', loadComponent: () => import('./dues/due-page').then((m) => m.DuePage) },
      {
        path: 'echeanciers/:id',
        // Named after the schedule once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Échéancier' },
        loadComponent: () =>
          import('./dues/due-schedule-detail').then((m) => m.DueScheduleDetailPage),
      },
      {
        path: ':id',
        data: { breadcrumb: 'Échéance' },
        loadComponent: () => import('./dues/due-item-detail').then((m) => m.DueItemDetailPage),
      },
    ],
  },
  // Trésorerie › Rapprochements (V2.1 A6): bank lines, proposals, reconciliations. Served
  // among the section's routes (placeholder-routes.ts): its home and breadcrumb stay the
  // section's; its other screens stay planned.
  {
    path: 'tresorerie/rapprochements',
    data: { breadcrumb: 'Rapprochements' },
    loadComponent: () =>
      import('../treasury/reconciliation/reconciliation-page').then((m) => m.ReconciliationPage),
  },
  // Analyse › Rapports de tiers: the aged balance (V2.1 A5), customers and suppliers.
  agedBalance('analyse/balance-clients', 'Balance clients', 'customer'),
  agedBalance('analyse/balance-fournisseurs', 'Balance fournisseurs', 'supplier'),
  {
    path: 'configuration/balance-agee',
    data: { breadcrumb: 'Tranches de la balance âgée' },
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('../reporting/aging/aging-policy-page').then((m) => m.AgingPolicyPage),
  },
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
