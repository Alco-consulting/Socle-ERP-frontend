import { Route, Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { PartnerRole } from './data-access/partner-models';
import { PARTNER_TRANSFER } from './partner-presentation';

const list = () => import('./pages/partner-list/partner-list').then((m) => m.PartnerListPage);
const detail = () =>
  import('./pages/partner-detail/partner-detail').then((m) => m.PartnerDetailPage);
const form = () => import('./pages/partner-form/partner-form').then((m) => m.PartnerFormPage);
const importPage = () => import('../transfers/import-page/import-page').then((m) => m.ImportPage);

/**
 * A list of the Tiers application (Tous les tiers, Clients, Fournisseurs) with, under it,
 * the contextual import, the record and its modification:
 * `/app/tiers/clients`, `…/clients/import`, `…/clients/:id`, `…/clients/:id/modifier`.
 */
function listScreen(path: string, label: string, role: PartnerRole | null): Route {
  return {
    path,
    data: { breadcrumb: label },
    children: [
      { path: '', data: { role }, loadComponent: list },
      {
        path: 'import',
        data: { breadcrumb: 'Import de tiers', transfer: PARTNER_TRANSFER },
        canActivate: [permissionGuard('imports_exports.create', 'partners.create')],
        loadComponent: importPage,
      },
      {
        path: ':id',
        // Named after the partner once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Fiche du tiers' },
        children: [
          { path: '', loadComponent: detail },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard('partners.update')],
            loadComponent: form,
          },
        ],
      },
    ],
  };
}

/**
 * Screens of the Tiers application, on the real API (`partners`). « Configuration ›
 * Conditions de paiement » is still a planned screen (placeholder of the shell).
 */
export const PARTNER_ROUTES: Routes = [
  listScreen('liste', 'Tous les tiers', null),
  listScreen('clients', 'Clients', 'customer'),
  listScreen('fournisseurs', 'Fournisseurs', 'supplier'),
  {
    path: 'nouveau',
    data: { breadcrumb: 'Nouveau tiers' },
    canActivate: [permissionGuard('partners.create')],
    loadComponent: form,
  },
];
