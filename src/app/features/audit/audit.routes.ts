import { Routes } from '@angular/router';

/**
 * Comptabilité › Audit › Journal d'audit on the API (`audit/events/`). Paths start with the
 * section's (`audit/…`): served among the section's routes, whose guard checks `audit.read`.
 */
export const AUDIT_ROUTES: Routes = [
  {
    path: 'audit/journal',
    data: { breadcrumb: 'Journal d’audit' },
    children: [
      {
        path: '',
        loadComponent: () => import('./audit-journal').then((m) => m.AuditJournalPage),
      },
      {
        path: ':id',
        // Named after its action once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Événement' },
        loadComponent: () => import('./audit-event').then((m) => m.AuditEventPage),
      },
    ],
  },
];
