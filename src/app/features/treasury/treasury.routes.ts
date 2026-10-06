import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';
// The import's description only: the routes stay light (loaded with the application).
import { STATEMENT_TRANSFER } from './statement-transfer';

const accountForm = () => import('./accounts/account-form').then((m) => m.TreasuryAccountFormPage);
const operationForm = () =>
  import('./operations/operation-form').then((m) => m.TreasuryOperationFormPage);

/**
 * Comptabilité › Trésorerie (Module 6) on the API: treasury accounts, operations, transfers,
 * statements (and their import) and the bank reconciliation (V2.1 A6). Paths are relative to
 * Comptabilité and start with the section's (`tresorerie/…`): they are served among the
 * section's routes (placeholder-routes.ts), its home and breadcrumb staying the section's.
 * The section's guard checks `treasury.read`; each write screen checks its own permission.
 */
export const TREASURY_ROUTES: Routes = [
  {
    path: 'tresorerie/comptes',
    data: { breadcrumb: 'Comptes de trésorerie' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./accounts/account-list').then((m) => m.TreasuryAccountListPage),
      },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouveau compte' },
        canActivate: [permissionGuard('treasury.manage_accounts')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: accountForm,
      },
      {
        path: ':id',
        // Named after the account once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Compte' },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./accounts/account-detail').then((m) => m.TreasuryAccountDetailPage),
          },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard('treasury.manage_accounts')],
            canDeactivate: [unsavedChangesGuard],
            loadComponent: accountForm,
          },
        ],
      },
    ],
  },
  {
    path: 'tresorerie/operations',
    data: { breadcrumb: 'Opérations' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./operations/operation-list').then((m) => m.TreasuryOperationListPage),
      },
      {
        path: 'nouvelle',
        data: { breadcrumb: 'Nouvelle opération' },
        canActivate: [permissionGuard('treasury.create')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: operationForm,
      },
      {
        path: ':id',
        data: { breadcrumb: 'Opération' },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./operations/operation-detail').then((m) => m.TreasuryOperationDetailPage),
          },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard('treasury.update')],
            canDeactivate: [unsavedChangesGuard],
            loadComponent: operationForm,
          },
        ],
      },
    ],
  },
  {
    path: 'tresorerie/virements',
    data: { breadcrumb: 'Virements' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./transfers/transfer-list').then((m) => m.TreasuryTransferListPage),
      },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouveau virement' },
        canActivate: [permissionGuard('treasury.create')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./transfers/transfer-form').then((m) => m.TreasuryTransferFormPage),
      },
      {
        path: ':id',
        data: { breadcrumb: 'Virement' },
        loadComponent: () =>
          import('./transfers/transfer-detail').then((m) => m.TreasuryTransferDetailPage),
      },
    ],
  },
  {
    path: 'tresorerie/releves',
    data: { breadcrumb: 'Relevés' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./statements/statement-list').then((m) => m.TreasuryStatementListPage),
      },
      {
        path: 'import',
        data: { breadcrumb: 'Import de relevés', transfer: STATEMENT_TRANSFER },
        canActivate: [permissionGuard('imports_exports.create', 'treasury.manage_statements')],
        loadComponent: () =>
          import('../transfers/import-page/import-page').then((m) => m.ImportPage),
      },
      {
        path: ':id',
        data: { breadcrumb: 'Relevé' },
        loadComponent: () =>
          import('./statements/statement-detail').then((m) => m.TreasuryStatementDetailPage),
      },
    ],
  },
  // Bank reconciliation (V2.1 A6): bank lines, proposals, reconciliations.
  {
    path: 'tresorerie/rapprochements',
    data: { breadcrumb: 'Rapprochements' },
    loadComponent: () =>
      import('./reconciliation/reconciliation-page').then((m) => m.ReconciliationPage),
  },
];
