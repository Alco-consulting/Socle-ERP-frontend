import { Routes } from '@angular/router';

import { APPLICATIONS } from '../../core/navigation/applications';
import { ACCOUNTING_ROUTES } from '../accounting/accounting.routes';
import { DOCUMENT_ROUTES } from '../documents/documents.routes';
import { PARTNER_ROUTES, partnerListScreen } from '../partners/partners.routes';
import { SETTINGS_ROUTES } from '../settings/settings.routes';
import { applicationRoute } from './placeholder-routes';

/**
 * Screens built by the prototype, per application; every other screen is a placeholder.
 * `demo: true`: fictitious data, said by the demonstration strip (prototype-banner.ts).
 */
const SCREENS: Readonly<Record<string, Routes>> = {
  // Real screens (Modules 4 and 5, V2.1 dashboard), on the API; Clients, Fournisseurs and
  // Comptabilité › Contacts are the Contacts application's lists (records stay in Contacts).
  accounting: [
    ...ACCOUNTING_ROUTES,
    partnerListScreen('clients', 'Clients', 'customer'),
    partnerListScreen('fournisseurs', 'Fournisseurs', 'supplier'),
    partnerListScreen('contacts', 'Contacts', null),
  ],
  // Real screens (Module 3), on the API.
  partners: PARTNER_ROUTES,
  documents: DOCUMENT_ROUTES,
  settings: SETTINGS_ROUTES,
};

/**
 * Former URLs (bookmarks, shared links) of screens that moved (V2.1): Reporting is
 * Comptabilité › Analyse, Comptabilité › Tiers › Clients is Comptabilité › Clients, payment
 * terms and currencies are Comptabilité › Configuration. Plain redirects to a screen whose own guards then
 * apply (no permission is decided here). A function without API (journal centralisateur)
 * leads to the application's home; the former lettering and due dates URLs lead to
 * Comptabilité › Lettrage and › Échéances.
 */
const ACCOUNTING = '/app/comptabilite';
export const LEGACY_REDIRECTS: Routes = [
  {
    path: 'reporting',
    children: [
      { path: 'balance', redirectTo: `${ACCOUNTING}/analyse/balance` },
      { path: 'grand-livre', redirectTo: `${ACCOUNTING}/analyse/grand-livre` },
      { path: 'etats-financiers', redirectTo: `${ACCOUNTING}/analyse/etats-financiers` },
      { path: '**', redirectTo: `${ACCOUNTING}/analyse/balance` },
    ],
  },
  {
    path: 'comptabilite/rapports',
    children: [
      { path: 'balance', redirectTo: `${ACCOUNTING}/analyse/balance` },
      { path: 'grand-livre', redirectTo: `${ACCOUNTING}/analyse/grand-livre` },
      { path: '**', redirectTo: ACCOUNTING },
    ],
  },
  {
    path: 'comptabilite/tiers/clients',
    pathMatch: 'full',
    redirectTo: `${ACCOUNTING}/clients`,
  },
  {
    path: 'comptabilite/tiers/fournisseurs',
    pathMatch: 'full',
    redirectTo: `${ACCOUNTING}/fournisseurs`,
  },
  {
    path: 'comptabilite/tiers/echeances',
    pathMatch: 'full',
    redirectTo: `${ACCOUNTING}/echeances`,
  },
  { path: 'comptabilite/tiers/lettrage', pathMatch: 'full', redirectTo: `${ACCOUNTING}/lettrage` },
  // « Tiers » became « Contacts », as Odoo's application (2026-10-17).
  { path: 'comptabilite/tiers', pathMatch: 'full', redirectTo: `${ACCOUNTING}/contacts` },
  { path: 'comptabilite/tiers/:id', redirectTo: `${ACCOUNTING}/contacts/:id` },
  {
    path: 'tiers/configuration/conditions',
    pathMatch: 'full',
    redirectTo: `${ACCOUNTING}/configuration/conditions-paiement`,
  },
  { path: 'tiers', pathMatch: 'full', redirectTo: '/app/contacts' },
  { path: 'tiers/:screen', redirectTo: '/app/contacts/:screen' },
  { path: 'tiers/:screen/:id', redirectTo: '/app/contacts/:screen/:id' },
  { path: 'tiers/:screen/:id/:action', redirectTo: '/app/contacts/:screen/:id/:action' },
  // Paramètres › Devises (placeholder) became Comptabilité › Configuration › Devises.
  {
    path: 'parametres/devises',
    pathMatch: 'full',
    redirectTo: `${ACCOUNTING}/configuration/devises`,
  },
];

/**
 * PROTOTYPE — one shell per application of the catalogue, after the former URLs. There is
 * no route for an « Import / Export » nor a « Reporting » application.
 */
export const APPLICATION_ROUTES: Routes = [
  ...LEGACY_REDIRECTS,
  ...APPLICATIONS.map((app) => applicationRoute(app, SCREENS[app.id] ?? [])),
];
