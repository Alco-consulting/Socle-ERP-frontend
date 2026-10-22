import { Routes } from '@angular/router';

import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const member = () => import('./member-page/member-page').then((m) => m.MemberPage);

/** Screens of the Paramètres application, on the real API (`companies`, `users`). */
export const SETTINGS_ROUTES: Routes = [
  {
    path: 'societe',
    data: { breadcrumb: 'Société' },
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./company-page/company-page').then((m) => m.CompanyPage),
  },
  {
    path: 'utilisateurs',
    data: { breadcrumb: 'Utilisateurs' },
    loadComponent: () => import('./user-list/user-list').then((m) => m.UserListPage),
  },
  {
    path: 'roles',
    data: { breadcrumb: 'Rôles et droits' },
    children: [
      {
        path: '',
        loadComponent: () => import('./member-list/member-list').then((m) => m.MemberListPage),
      },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouveau membre' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: member,
      },
      {
        // Named after the member once loaded (BreadcrumbService.nameCurrent).
        path: ':id',
        data: { breadcrumb: 'Membre' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: member,
      },
    ],
  },
];
