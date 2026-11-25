import { IconName } from '../../shared/ui/icon/icons';

/** Color family of an application (tokens `--app-family-*`): one color per family. */
export type AppFamily = 'finance' | 'relations' | 'steering' | 'control';

/** A screen reachable from a menu. */
export interface AppNavLink {
  readonly label: string;
  /** Path relative to the application (or to the section, inside a section). */
  readonly path: string;
  /** Extra permission needed for this screen, on top of its application's or section's. */
  readonly permission?: string;
  /** Title of the link's group in its menu (« Rapports financiers »), see `group()`. */
  readonly group?: string;
  /**
   * A function the API does not offer yet: shown disabled with this reason,
   * no route, no screen. Never presented as operational.
   */
  readonly unavailable?: string;
}

/** A top-level menu entry: a direct link, or a menu (« Analyse ▾ ») of links, maybe grouped. */
export interface AppNavEntry {
  readonly label: string;
  /** Drawn before the label in the menu. */
  readonly icon?: IconName;
  readonly path?: string;
  /** Permission of the entry; for a group, required by all its links. */
  readonly permission?: string;
  readonly children?: readonly AppNavLink[];
}

/**
 * A functional domain inside an application (Trésorerie inside Comptabilité): its own
 * screens and its own horizontal navigation, shown under the application's navigation.
 * Never an application of the launcher.
 */
export interface AppSection {
  readonly label: string;
  readonly path: string;
  /** Backend permission that makes the domain visible. */
  readonly permission: string;
  /** Optional domain the company must use (`SessionStore.features`). */
  readonly feature?: string;
  readonly nav: readonly AppNavEntry[];
  /** No menu bar: its screens open from elsewhere (Trésorerie: the dashboard's cards). */
  readonly withoutBar?: boolean;
}

export interface AlcoApplication {
  readonly id: string;
  readonly label: string;
  /** One short line on the launcher tile. */
  readonly description: string;
  readonly icon: IconName;
  /** The application's picture (public/svg, provided by Alco), drawn as given. */
  readonly image: string;
  readonly family: AppFamily;
  /** URL segment: /comptabilite */
  readonly path: string;
  /**
   * Backend permission that makes the application visible (`<domain>.read`). Without one, the
   * application is visible as soon as one of its screens is (each screen has its own).
   */
  readonly permission?: string;
  readonly nav: readonly AppNavEntry[];
  /**
   * Écrans hors menu, ouverts depuis d'autres écrans (la fiche d'un contact depuis une
   * écriture) : jamais affichés dans le menu, mais leurs droits restent appliqués.
   */
  readonly offMenu?: readonly AppNavLink[];
  readonly sections?: readonly AppSection[];
  /** Words that also find the application in the launcher search. */
  readonly keywords?: readonly string[];
}

/**
 * Catalogue of the applications, in launcher order: a few broad applications, many
 * functions organised inside them.
 * - Treasury, fixed assets, loans, taxes, analytics and audit are SECTIONS of Comptabilité,
 *   never applications of the launcher. Reporting is not an application either: its reports
 *   are Comptabilité › Analyse (the backend's `reporting` stays their source).
 * - Comptabilité: Tableau de bord, Clients, Fournisseurs, then three menus — Comptabilité ▾,
 *   Analyse ▾ and Configuration ▾, their links grouped under titles (`group()`).
 * - Import / export is a contextual action of each domain (« Actions ▾ »), never an
 *   application, a menu entry or a route of its own.
 * Only navigation lives here: each domain's screens are provided by its feature.
 */
export const APPLICATIONS: readonly AlcoApplication[] = [
  {
    id: 'accounting',
    label: 'Comptabilité',
    description: 'Écritures, trésorerie, analyse, configuration…',
    icon: 'accounting',
    image: 'svg/comptabilite.svg',
    family: 'finance',
    path: 'comptabilite',
    permission: 'accounting.read',
    keywords: [
      'écriture',
      'journal',
      'compte',
      'client',
      'fournisseur',
      'trésorerie',
      'banque',
      'caisse',
      'rapprochement',
      'clôture',
      'analyse',
      'rapport',
      'reporting',
      'balance',
      'grand livre',
      'bilan',
      'état financier',
      'résultat',
      'immobilisation',
      'amortissement',
      'emprunt',
      'taxe',
      'tva',
      'devise',
      'taux de change',
      'analytique',
      'audit',
    ],
    nav: [
      {
        label: 'Tableau de bord',
        icon: 'dashboard',
        path: 'tableau-de-bord',
        permission: 'dashboards.read',
      },
      // As Odoo's Facturation (note backend 0038): the documents, then the products and
      // the partners of the side.
      {
        label: 'Clients',
        icon: 'partners',
        children: [
          { label: 'Factures', path: 'ventes/factures', permission: 'invoicing.read' },
          { label: 'Avoirs', path: 'ventes/avoirs', permission: 'invoicing.read' },
          { label: 'Produits', path: 'produits', permission: 'invoicing.read' },
          { label: 'Clients', path: 'clients', permission: 'partners.read' },
        ],
      },
      {
        label: 'Fournisseurs',
        icon: 'company',
        children: [
          { label: 'Factures', path: 'achats/factures', permission: 'invoicing.read' },
          { label: 'Avoirs', path: 'achats/avoirs', permission: 'invoicing.read' },
          { label: 'Produits', path: 'produits', permission: 'invoicing.read' },
          { label: 'Fournisseurs', path: 'fournisseurs', permission: 'partners.read' },
        ],
      },
      {
        label: 'Comptabilité',
        icon: 'book',
        // Sans doublon : Journaux et Plan comptable sont dans Configuration, Contacts dans son
        // application (et Clients, Fournisseurs), Échéances dans Analyse › Rapports de tiers.
        children: [
          { label: 'Écritures', path: 'ecritures' },
          { label: 'Pièces comptables', path: 'ecritures/pieces' },
          { label: 'Lettrage', path: 'lettrage' },
          { label: 'Clôture', path: 'cloture', permission: 'closing.read' },
        ],
      },
      {
        label: 'Analyse',
        icon: 'analytics',
        children: [
          ...group('Rapports financiers', [
            {
              label: 'Bilan',
              path: 'analyse/bilan',
              permission: 'reporting.read_financial_statements',
            },
            {
              label: 'Compte de résultat',
              path: 'analyse/resultat',
              permission: 'reporting.read_financial_statements',
            },
          ]),
          ...group('Rapports comptables', [
            { label: 'Balance comptable', path: 'analyse/balance', permission: 'reporting.read' },
            { label: 'Grand livre', path: 'analyse/grand-livre', permission: 'reporting.read' },
          ]),
          ...group('Rapports de tiers', [
            { label: 'Échéances', path: 'echeances' },
            {
              label: 'Balance clients',
              path: 'analyse/balance-clients',
              permission: 'reporting.read_auxiliary',
            },
            {
              label: 'Balance fournisseurs',
              path: 'analyse/balance-fournisseurs',
              permission: 'reporting.read_auxiliary',
            },
            {
              label: 'Grand livre des partenaires',
              path: 'analyse/grand-livre-auxiliaire',
              permission: 'reporting.read_auxiliary',
            },
          ]),
          ...group('Analyses', [
            {
              label: 'Analytique',
              path: 'analytique/rapports',
              permission: 'reporting.read_analytics',
            },
            { label: 'Immobilisations', path: 'immobilisations/actifs' },
            { label: 'Emprunts', path: 'emprunts/liste' },
            { label: 'Journal d’audit', path: 'audit/journal' },
          ]),
        ],
      },
      {
        label: 'Configuration',
        icon: 'settings',
        children: [
          ...group('Général', [
            { label: 'Paramètres comptables', path: 'configuration/parametres' },
          ]),
          ...group('Comptabilité', [
            { label: 'Journaux', path: 'journaux' },
            { label: 'Plan comptable', path: 'plan-comptable' },
            {
              label: 'Devises',
              path: 'configuration/devises',
              permission: 'currencies.read',
            },
          ]),
          // As Odoo's « Produits » of its Configuration (note backend 0047).
          ...group('Produits', [
            {
              label: 'Unités de mesure',
              path: 'configuration/unites',
              permission: 'invoicing.read',
            },
          ]),
          ...group('Taxes', [{ label: 'Taxes', path: 'taxes/liste' }]),
          ...group('Immobilisations', [
            { label: 'Catégories', path: 'immobilisations/categories' },
          ]),
          ...group('Analytique', [
            { label: 'Axes', path: 'analytique/axes' },
            { label: 'Valeurs', path: 'analytique/valeurs' },
            { label: 'Règles', path: 'analytique/regles' },
          ]),
          ...group('Emprunts', [{ label: 'Types d’emprunt', path: 'emprunts/types' }]),
        ],
      },
    ],
    // La fiche d'un contact, ouverte depuis une écriture, une échéance, un lettrage ou une
    // opération : hors du menu Comptabilité (doublon de l'application Contacts), même droit.
    offMenu: [{ label: 'Contacts', path: 'contacts', permission: 'partners.read' }],
    sections: [
      // No « Trésorerie » tab, as Odoo (note backend 0043): its screens open from the bank
      // and cash cards of the dashboard.
      {
        label: 'Trésorerie',
        path: 'tresorerie',
        permission: 'treasury.read',
        feature: 'treasury',
        withoutBar: true,
        nav: [
          { label: 'Transactions', path: 'transactions' },
          { label: 'Opérations', path: 'operations' },
          { label: 'Virements', path: 'virements' },
          { label: 'Relevés', path: 'releves' },
          { label: 'Rapprochements', path: 'rapprochements' },
        ],
      },
      {
        label: 'Immobilisations',
        path: 'immobilisations',
        permission: 'assets.read',
        feature: 'assets',
        nav: [
          { label: 'Actifs', path: 'actifs' },
          { label: 'Catégories', path: 'categories' },
          { label: 'Amortissements', path: 'amortissements' },
        ],
      },
      {
        label: 'Emprunts',
        path: 'emprunts',
        permission: 'loans.read',
        feature: 'loans',
        nav: [
          { label: 'Emprunts', path: 'liste' },
          { label: 'Échéanciers', path: 'echeanciers' },
          { label: 'Remboursements', path: 'remboursements' },
          { label: 'Taux', path: 'taux' },
          { label: 'Plus', children: [{ label: 'Types d’emprunt', path: 'types' }] },
        ],
      },
      {
        label: 'Taxes',
        path: 'taxes',
        permission: 'taxes.read',
        feature: 'taxes',
        nav: [
          { label: 'Taxes', path: 'liste' },
          { label: 'Déclarations', path: 'declarations' },
        ],
      },
      {
        label: 'Analytique',
        path: 'analytique',
        permission: 'analytics.read',
        feature: 'analytics',
        nav: [
          { label: 'Axes', path: 'axes' },
          { label: 'Valeurs', path: 'valeurs' },
          { label: 'Règles', path: 'regles' },
          { label: 'Répartitions', path: 'repartitions' },
          { label: 'Plus', children: [{ label: 'Rapports analytiques', path: 'rapports' }] },
        ],
      },
      {
        label: 'Audit',
        path: 'audit',
        permission: 'audit.read',
        nav: [{ label: 'Journal d’audit', path: 'journal' }],
      },
    ],
  },
  {
    id: 'partners',
    label: 'Contacts',
    description: 'Fiches clients et fournisseurs',
    icon: 'partners',
    image: 'svg/tiers.svg',
    family: 'relations',
    path: 'contacts',
    permission: 'partners.read',
    keywords: ['client', 'fournisseur', 'partenaire', 'tiers'],
    nav: [
      { label: 'Tous les contacts', icon: 'partners', path: 'liste' },
      { label: 'Clients', icon: 'user', path: 'clients' },
      { label: 'Fournisseurs', icon: 'company', path: 'fournisseurs' },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Pièces justificatives',
    icon: 'documents',
    image: 'svg/documents.svg',
    family: 'relations',
    path: 'documents',
    permission: 'documents.read',
    keywords: ['pièce', 'justificatif', 'fichier'],
    nav: [{ label: 'Documents', icon: 'documents', path: 'liste' }],
  },
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    description: 'Vue d’ensemble de la société',
    icon: 'dashboard',
    image: 'svg/tableau-de-bord.svg',
    family: 'steering',
    path: 'tableau-de-bord',
    permission: 'dashboards.read',
    keywords: ['dashboard', 'indicateur', 'kpi', 'pilotage'],
    nav: [{ label: 'Vue d’ensemble', icon: 'dashboard', path: 'vue-ensemble' }],
  },
  {
    id: 'settings',
    label: 'Paramètres',
    description: 'Société, utilisateurs et droits',
    icon: 'settings',
    image: 'svg/parametres.svg',
    family: 'control',
    path: 'parametres',
    keywords: ['utilisateur', 'rôle', 'droit', 'société'],
    // Each screen needs the permission of its API (OpenAPI x-permissions): a company
    // administrator without the global `users.read` still reaches its company and members.
    nav: [
      { label: 'Société', icon: 'company', path: 'societe', permission: 'companies.read' },
      { label: 'Utilisateurs', icon: 'user', path: 'utilisateurs', permission: 'users.read' },
      {
        label: 'Rôles et droits',
        icon: 'lock',
        path: 'roles',
        permission: 'companies.manage_members',
      },
    ],
  },
];

/** Links shown under one title in their menu (« Rapports financiers »). */
export function group(title: string, links: readonly AppNavLink[]): AppNavLink[] {
  return links.map((link) => ({ ...link, group: title }));
}

/** Root of the authenticated area: `/app` is the launcher, `/app/<application>/…` the rest. */
export const APP_ROOT = '/app';

/**
 * Path of an application URL relative to its application: `/app/comptabilite/ecritures?x`
 * → `{ app: 'comptabilite', rest: ['ecritures'] }`; `null` outside the applications.
 */
export function splitAppUrl(url: string): { app: string; rest: string[] } | null {
  const [root, app, ...rest] = url.split(/[?#]/)[0].split('/').filter(Boolean);
  return `/${root}` === APP_ROOT && app ? { app, rest } : null;
}

export function findApplication(id: string): AlcoApplication | undefined {
  return APPLICATIONS.find((app) => app.id === id);
}

/** The application of an URL segment (`comptabilite` → Comptabilité). */
export function applicationAt(path: string): AlcoApplication | undefined {
  return APPLICATIONS.find((app) => app.path === path);
}

export function findSection(app: AlcoApplication, path: string): AppSection | undefined {
  return app.sections?.find((section) => section.path === path);
}

/** Every screen link of a menu, menus flattened; an unavailable function has no screen. */
export function menuLinks(nav: readonly AppNavEntry[]): AppNavLink[] {
  return nav.flatMap((entry) =>
    entry.children
      ? entry.children
          .filter((child) => !child.unavailable)
          .map((child) => ({
            ...child,
            permission: child.permission ?? entry.permission,
          }))
      : entry.path !== undefined
        ? [{ label: entry.label, path: entry.path, permission: entry.permission }]
        : [],
  );
}
