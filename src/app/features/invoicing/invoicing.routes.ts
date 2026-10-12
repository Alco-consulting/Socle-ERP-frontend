import { Route, Routes } from '@angular/router';

import { permissionGuard } from '../../core/navigation/app-access.guard';
import { unsavedChangesGuard } from '../../core/navigation/unsaved-changes';
import { InvoiceKind } from './data-access/invoicing-models';
import { KINDS } from './invoicing-presentation';

const invoiceForm = () => import('./invoice-form').then((m) => m.InvoiceFormPage);
const productForm = () => import('./product-form').then((m) => m.ProductFormPage);

/** A list of one kind of document, its creation (invoices only) and its records. */
function documents(kind: InvoiceKind): Route {
  const spec = KINDS[kind];
  return {
    path: spec.path,
    data: { breadcrumb: spec.title, kind },
    children: [
      { path: '', loadComponent: () => import('./invoice-list').then((m) => m.InvoiceListPage) },
      ...(spec.creatable
        ? [
            {
              path: 'nouvelle',
              data: { breadcrumb: 'Nouvelle facture' },
              canActivate: [permissionGuard('invoicing.create')],
              canDeactivate: [unsavedChangesGuard],
              loadComponent: invoiceForm,
            },
          ]
        : []),
      {
        path: ':id',
        // Named after the document once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: spec.word },
        children: [
          {
            path: '',
            loadComponent: () => import('./invoice-detail').then((m) => m.InvoiceDetailPage),
          },
          {
            path: 'modifier',
            data: { breadcrumb: 'Modifier' },
            canActivate: [permissionGuard('invoicing.update')],
            canDeactivate: [unsavedChangesGuard],
            loadComponent: invoiceForm,
          },
        ],
      },
    ],
  };
}

/**
 * Facturation (note backend 0038), in Comptabilité: Clients ▾ › Factures, Avoirs, Produits;
 * Fournisseurs ▾ › Factures, Avoirs, Produits. Paths are relative to Comptabilité; the menu
 * links (catalogue) check `invoicing.read`.
 */
export const INVOICING_ROUTES: Routes = [
  documents('customer_invoice'),
  documents('customer_credit_note'),
  documents('supplier_invoice'),
  documents('supplier_credit_note'),
  {
    path: 'produits',
    data: { breadcrumb: 'Produits' },
    children: [
      { path: '', loadComponent: () => import('./product-list').then((m) => m.ProductListPage) },
      {
        path: 'nouveau',
        data: { breadcrumb: 'Nouveau produit' },
        canActivate: [permissionGuard('invoicing.manage_products')],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: productForm,
      },
      {
        path: ':id',
        // Named after the product once loaded (BreadcrumbService.nameCurrent).
        data: { breadcrumb: 'Produit' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: productForm,
      },
    ],
  },
];
