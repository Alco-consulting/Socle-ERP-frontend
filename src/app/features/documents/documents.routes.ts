import { Routes } from '@angular/router';

/** Screens of the Documents application, on the real API (`documents`). */
export const DOCUMENT_ROUTES: Routes = [
  {
    path: 'liste',
    data: { breadcrumb: 'Documents' },
    loadComponent: () => import('./document-list/document-list').then((m) => m.DocumentListPage),
  },
];
