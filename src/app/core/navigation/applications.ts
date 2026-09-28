import { IconName } from '../../shared/ui/icon/icons';

/** Color family of an application (tokens `--app-family-*`): one color per family. */
export type AppFamily = 'finance' | 'flows' | 'relations' | 'steering' | 'control';

export interface AppNavLink {
  readonly label: string;
  /** Path relative to the application's path. */
  readonly path: string;
  /** Extra permission needed for this screen (on top of the application's). */
  readonly permission?: string;
}

export interface AppNavEntry {
  readonly label: string;
  readonly path?: string;
  readonly permission?: string;
  /** Group opened as a menu (« Rapports ▾ », « Plus ▾ »). */
  readonly children?: readonly AppNavLink[];
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
  /** Words that also find the application in the launcher search. */
  readonly keywords?: readonly string[];
}

/**
 * Catalogue of the applications, in launcher order. Only navigation lives here: each
 * application's screens are provided by its feature. The launcher and the guards show
 * an application only if the user holds `permission` in the active company.
 */
export const APPLICATIONS: readonly AlcoApplication[] = [
  {
    id: 'accounting',
    label: 'Comptabilité',
    description: 'Écritures, journaux et plan comptable',
    icon: 'accounting',
    family: 'finance',
    path: 'comptabilite',
    permission: 'accounting.read',
    keywords: ['écriture', 'journal', 'compte', 'balance', 'grand livre'],
    nav: [
      { label: 'Tableau de bord', path: 'tableau-de-bord' },
      { label: 'Écritures', path: 'ecritures' },
      { label: 'Journaux', path: 'journaux' },
      { label: 'Plan comptable', path: 'plan-comptable' },
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
          { label: 'Lettrage', path: 'lettrage' },
          { label: 'Clôture', path: 'cloture', permission: 'closing.read' },
        ],
      },
    ],
  },
  {
    id: 'treasury',
    label: 'Trésorerie',
    description: 'Banques, caisses et rapprochements',
    icon: 'treasury',
    family: 'flows',
    path: 'tresorerie',
    permission: 'treasury.read',
    keywords: ['banque', 'caisse', 'rapprochement'],
    nav: [
      { label: 'Tableau de bord', path: 'tableau-de-bord' },
      { label: 'Comptes', path: 'comptes' },
      { label: 'Opérations', path: 'operations' },
      { label: 'Rapprochement', path: 'rapprochement' },
      { label: 'Configuration', path: 'configuration' },
    ],
  },
  {
    id: 'partners',
    label: 'Tiers',
    description: 'Clients, fournisseurs et échéances',
    icon: 'partners',
    family: 'relations',
    path: 'tiers',
    permission: 'partners.read',
    keywords: ['client', 'fournisseur', 'partenaire'],
    nav: [
      { label: 'Clients', path: 'clients' },
      { label: 'Fournisseurs', path: 'fournisseurs' },
      { label: 'Échéances', path: 'echeances' },
      { label: 'Configuration', path: 'configuration' },
    ],
  },
  {
    id: 'assets',
    label: 'Immobilisations',
    description: 'Biens, amortissements et cessions',
    icon: 'assets',
    family: 'steering',
    path: 'immobilisations',
    permission: 'assets.read',
    keywords: ['amortissement', 'actif'],
    nav: [
      { label: 'Immobilisations', path: 'liste' },
      { label: 'Amortissements', path: 'amortissements' },
      { label: 'Configuration', path: 'configuration' },
    ],
  },
  {
    id: 'loans',
    label: 'Emprunts',
    description: 'Contrats, échéanciers et remboursements',
    icon: 'loans',
    family: 'flows',
    path: 'emprunts',
    permission: 'loans.read',
    keywords: ['prêt', 'échéancier', 'crédit'],
    nav: [
      { label: 'Emprunts', path: 'liste' },
      { label: 'Échéanciers', path: 'echeanciers' },
      { label: 'Configuration', path: 'configuration' },
    ],
  },
  {
    id: 'taxes',
    label: 'Taxes',
    description: 'TVA, règles et déclarations',
    icon: 'taxes',
    family: 'finance',
    path: 'taxes',
    permission: 'taxes.read',
    keywords: ['tva', 'impôt', 'déclaration'],
    nav: [
      { label: 'Taxes', path: 'liste' },
      { label: 'Déclarations', path: 'declarations' },
      { label: 'Configuration', path: 'configuration' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytique',
    description: 'Axes, sections et répartitions',
    icon: 'analytics',
    family: 'finance',
    path: 'analytique',
    permission: 'analytics.read',
    keywords: ['axe', 'section', 'répartition', 'centre de coût'],
    nav: [
      { label: 'Axes', path: 'axes' },
      { label: 'Répartitions', path: 'repartitions' },
      { label: 'Rapports', path: 'rapports' },
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
    id: 'audit',
    label: 'Audit',
    description: 'Historique des actions et contrôles',
    icon: 'audit',
    family: 'control',
    path: 'audit',
    permission: 'audit.read',
    keywords: ['historique', 'trace', 'journal d’audit'],
    nav: [{ label: 'Journal d’audit', path: 'journal' }],
  },
  {
    id: 'transfers',
    label: 'Imports / Exports',
    description: 'Imports de données et exports',
    icon: 'transfers',
    family: 'control',
    path: 'imports-exports',
    permission: 'imports_exports.read',
    keywords: ['import', 'export', 'fichier', 'excel', 'csv'],
    nav: [
      { label: 'Imports', path: 'imports' },
      { label: 'Exports', path: 'exports' },
      { label: 'Suivi des traitements', path: 'traitements' },
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
    keywords: ['dashboard', 'indicateur', 'kpi'],
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

/** First screen of an application (its first allowed navigation link). */
export function defaultPath(app: AlcoApplication): string {
  const first = app.nav[0];
  return first.path ?? first.children?.[0]?.path ?? '';
}
