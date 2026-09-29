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
}

/** A top-level menu entry: a direct link, or a group opened as a menu (« Rapports ▾ »). */
export interface AppNavEntry {
  readonly label: string;
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
}

export interface AlcoApplication {
  readonly id: string;
  readonly label: string;
  /** One short line on the launcher tile. */
  readonly description: string;
  readonly icon: IconName;
  readonly family: AppFamily;
  /** URL segment: /comptabilite */
  readonly path: string;
  /** Backend permission that makes the application visible (`<domain>.read`). */
  readonly permission: string;
  readonly nav: readonly AppNavEntry[];
  readonly sections?: readonly AppSection[];
  /** Words that also find the application in the launcher search. */
  readonly keywords?: readonly string[];
}

/**
 * Catalogue of the applications, in launcher order: a few broad applications, many
 * functions organised inside them.
 * - Treasury, fixed assets, loans, taxes, analytics and audit are SECTIONS of Comptabilité,
 *   never applications of the launcher.
 * - Import / export is a contextual action of each domain (« Actions ▾ »), never an
 *   application, a menu entry or a route of its own.
 * Only navigation lives here: each domain's screens are provided by its feature.
 */
export const APPLICATIONS: readonly AlcoApplication[] = [
  {
    id: 'accounting',
    label: 'Comptabilité',
    description: 'Écritures, trésorerie, immobilisations, taxes…',
    icon: 'accounting',
    family: 'finance',
    path: 'comptabilite',
    permission: 'accounting.read',
    keywords: [
      'écriture',
      'journal',
      'compte',
      'grand livre',
      'trésorerie',
      'banque',
      'caisse',
      'immobilisation',
      'amortissement',
      'emprunt',
      'taxe',
      'tva',
      'analytique',
      'audit',
      'lettrage',
      'clôture',
    ],
    nav: [
      { label: 'Tableau de bord', path: 'tableau-de-bord' },
      { label: 'Écritures', path: 'ecritures' },
      { label: 'Journaux', path: 'journaux' },
      { label: 'Plan comptable', path: 'plan-comptable' },
      { label: 'Tiers', path: 'tiers' },
      { label: 'Trésorerie', path: 'tresorerie' },
      {
        label: 'Rapports',
        permission: 'reporting.read',
        children: [
          { label: 'Balance générale', path: 'rapports/balance' },
          { label: 'Grand livre', path: 'rapports/grand-livre' },
          { label: 'Journal centralisateur', path: 'rapports/centralisateur' },
        ],
      },
      {
        label: 'Configuration',
        children: [
          { label: 'Exercices et périodes', path: 'configuration/exercices' },
          { label: 'Paramètres comptables', path: 'configuration/parametres' },
        ],
      },
      {
        label: 'Plus',
        children: [
          { label: 'Immobilisations', path: 'immobilisations' },
          { label: 'Emprunts', path: 'emprunts' },
          { label: 'Taxes', path: 'taxes' },
          { label: 'Analytique', path: 'analytique' },
          { label: 'Audit', path: 'audit' },
          { label: 'Clôture', path: 'cloture', permission: 'closing.read' },
        ],
      },
    ],
    sections: [
      {
        label: 'Tiers',
        path: 'tiers',
        permission: 'partners.read',
        nav: [
          { label: 'Clients', path: 'clients' },
          { label: 'Fournisseurs', path: 'fournisseurs' },
          { label: 'Échéances', path: 'echeances' },
          { label: 'Lettrage', path: 'lettrage' },
        ],
      },
      {
        label: 'Trésorerie',
        path: 'tresorerie',
        permission: 'treasury.read',
        feature: 'treasury',
        nav: [
          { label: 'Comptes de trésorerie', path: 'comptes' },
          { label: 'Opérations', path: 'operations' },
          { label: 'Virements', path: 'virements' },
          { label: 'Relevés', path: 'releves' },
          { label: 'Rapprochements', path: 'rapprochements' },
          { label: 'Plus', children: [{ label: 'Configuration', path: 'configuration' }] },
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
          { label: 'Dépréciations', path: 'depreciations' },
          { label: 'Cessions', path: 'cessions' },
          { label: 'Plus', children: [{ label: 'Configuration', path: 'configuration' }] },
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
          { label: 'Règles', path: 'regles' },
          { label: 'Déclarations', path: 'declarations' },
          { label: 'Plus', children: [{ label: 'Configuration', path: 'configuration' }] },
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
    label: 'Tiers',
    description: 'Fiches clients et fournisseurs',
    icon: 'partners',
    family: 'relations',
    path: 'tiers',
    permission: 'partners.read',
    keywords: ['client', 'fournisseur', 'partenaire', 'contact'],
    nav: [
      { label: 'Tous les tiers', path: 'liste' },
      { label: 'Clients', path: 'clients' },
      { label: 'Fournisseurs', path: 'fournisseurs' },
      {
        label: 'Configuration',
        children: [{ label: 'Conditions de paiement', path: 'configuration/conditions' }],
      },
    ],
  },
  {
    id: 'reporting',
    label: 'Reporting',
    description: 'Balances, grand livre et états financiers',
    icon: 'reporting',
    family: 'steering',
    path: 'reporting',
    permission: 'reporting.read',
    keywords: ['bilan', 'compte de résultat', 'état financier', 'balance'],
    nav: [
      { label: 'Balance', path: 'balance' },
      { label: 'Grand livre', path: 'grand-livre' },
      { label: 'États financiers', path: 'etats-financiers' },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Pièces justificatives',
    icon: 'documents',
    family: 'relations',
    path: 'documents',
    permission: 'documents.read',
    keywords: ['pièce', 'justificatif', 'fichier'],
    nav: [{ label: 'Documents', path: 'liste' }],
  },
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    description: 'Vue d’ensemble de la société',
    icon: 'dashboard',
    family: 'steering',
    path: 'tableau-de-bord',
    permission: 'dashboards.read',
    keywords: ['dashboard', 'indicateur', 'kpi', 'pilotage'],
    nav: [{ label: 'Vue d’ensemble', path: 'vue-ensemble' }],
  },
  {
    id: 'settings',
    label: 'Paramètres',
    description: 'Société, utilisateurs et droits',
    icon: 'settings',
    family: 'control',
    path: 'parametres',
    permission: 'users.read',
    keywords: ['utilisateur', 'rôle', 'droit', 'société', 'devise'],
    nav: [
      { label: 'Société', path: 'societe' },
      { label: 'Utilisateurs', path: 'utilisateurs' },
      { label: 'Rôles et droits', path: 'roles' },
      { label: 'Devises', path: 'devises' },
    ],
  },
];

export function findApplication(id: string): AlcoApplication | undefined {
  return APPLICATIONS.find((app) => app.id === id);
}

export function findSection(app: AlcoApplication, path: string): AppSection | undefined {
  return app.sections?.find((section) => section.path === path);
}

/** Every screen link of a menu, groups flattened. */
export function menuLinks(nav: readonly AppNavEntry[]): AppNavLink[] {
  return nav.flatMap((entry) =>
    entry.children
      ? entry.children.map((child) => ({
          ...child,
          permission: child.permission ?? entry.permission,
        }))
      : entry.path !== undefined
        ? [{ label: entry.label, path: entry.path, permission: entry.permission }]
        : [],
  );
}
