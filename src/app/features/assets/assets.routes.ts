import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';

const assetForm = () => import('./asset-form').then((m) => m.AssetFormPage);
const categoryForm = () => import('./category-form').then((m) => m.AssetCategoryFormPage);

/**
 * Comptabilité › Immobilisations (note backend 0060): assets, categories, depreciation. Paths
 * start with the section's (`immobilisations/…`), whose guard checks `assets.read`.
 */
export const ASSETS_ROUTES: Routes = [
  {
    path: 'immobilisations/actifs',
    data: { breadcrumb: 'Actifs' },
    children: [
      { path: '', loadComponent: () => import('./asset-list').then((m) => m.AssetListPage) },
      {
        path: 'nouvelle',
        data: { breadcrumb: 'Nouvelle immobilisation' },
        canActivate: [permissionGuard('assets.create')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: assetForm,
      },
      {
        path: ':id',
        // Named after the asset once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Immobilisation' },
        children: [
          {
            path: '',
            loadComponent: () => import('./asset-detail').then((m) => m.AssetDetailPage),
          },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard('assets.update')],
            canDeactivate: [unsavedChangesGuard],
            loadComponent: assetForm,
          },
        ],
      },
    ],
  },
  {
    path: 'immobilisations/categories',
    data: { breadcrumb: 'Catégories' },
    children: [
      {
        path: '',
        loadComponent: () => import('./category-list').then((m) => m.AssetCategoryListPage),
      },
      {
        path: 'nouvelle',
        data: { breadcrumb: 'Nouvelle catégorie' },
        canActivate: [permissionGuard('assets.manage_categories')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: categoryForm,
      },
      {
        path: ':id',
        data: { breadcrumb: 'Catégorie' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: categoryForm,
      },
    ],
  },
  {
    path: 'immobilisations/amortissements',
    data: { breadcrumb: 'Amortissements' },
    loadComponent: () => import('./depreciation-page').then((m) => m.DepreciationPage),
  },
];
