import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const loanForm = () => import('./loan-form').then((m) => m.LoanFormPage);
const typeForm = () => import('./type-form').then((m) => m.LoanTypeFormPage);

/**
 * Comptabilité › Emprunts (note backend 0062): loans and their types. Paths start with the
 * section's (`emprunts/…`), whose guard checks `loans.read`.
 */
export const LOANS_ROUTES: Routes = [
  {
    path: 'emprunts/liste',
    data: { breadcrumb: 'Emprunts' },
    children: [
      { path: '', loadComponent: () => import('./loan-list').then((m) => m.LoanListPage) },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouvel emprunt' },
        canActivate: [permissionGuard('loans.create')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: loanForm,
      },
      {
        path: ':id',
        // Named after the loan once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Emprunt' },
        children: [
          {
            path: '',
            loadComponent: () => import('./loan-detail').then((m) => m.LoanDetailPage),
          },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard('loans.update')],
            canDeactivate: [unsavedChangesGuard],
            loadComponent: loanForm,
          },
        ],
      },
    ],
  },
  {
    path: 'emprunts/types',
    data: { breadcrumb: 'Types d’emprunt' },
    children: [
      { path: '', loadComponent: () => import('./type-list').then((m) => m.LoanTypeListPage) },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouveau type' },
        canActivate: [permissionGuard('loans.manage_types')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: typeForm,
      },
      {
        path: ':id',
        data: { breadcrumb: 'Type' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: typeForm,
      },
    ],
  },
];
