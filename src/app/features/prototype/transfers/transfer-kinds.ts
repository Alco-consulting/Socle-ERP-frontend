/**
 * PROTOTYPE — imports and exports as contextual capabilities of each domain. Every kind
 * names exactly one operation of one domain; there is no generic « Import / Export »
 * screen where the user would pick an object type.
 * Mirrors the API V1 (`/api/v1/imports-exports/`): imports `accounting.entries` and
 * `partners`; exports `partners`, `reporting.balance`, `reporting.ledger`. A domain whose
 * operation the API does not offer (fixed assets, treasury operations) shows it disabled
 * with the reason — nothing is simulated beyond what the server can do.
 */

export interface ImportField {
  readonly label: string;
  readonly required: boolean;
}

export interface TransferKind {
  /** API type, or `null` when the API V1 has no such operation. */
  readonly importType: string | null;
  readonly exportType: string | null;
  /** « Importer des écritures » */
  readonly importLabel: string;
  /** « Exporter les écritures » */
  readonly exportLabel: string;
  /** Page title of the import: « Import d'écritures » */
  readonly importTitle: string;
  /** What the import creates, in one sentence. */
  readonly importEffect: string;
  /** Permissions on top of `imports_exports.create` / `imports_exports.export`. */
  readonly importPermission: string;
  readonly exportPermission: string;
  /** Columns of the API importer (the real list will come from `import-types/`). */
  readonly fields: readonly ImportField[];
}

export type TransferKindId = 'entries' | 'partners' | 'balance' | 'ledger' | 'assets' | 'treasury';

/** Shown under an operation the API does not offer yet. */
export const UNAVAILABLE_REASON = 'Pas encore proposé par l’API (V1)';

export const TRANSFER_KINDS: Readonly<Record<TransferKindId, TransferKind>> = {
  entries: {
    importType: 'accounting.entries',
    exportType: null,
    importLabel: 'Importer des écritures',
    exportLabel: 'Exporter les écritures',
    importTitle: 'Import d’écritures',
    importEffect:
      'Crée des écritures en brouillon à partir d’un fichier CSV ; elles restent à valider.',
    importPermission: 'accounting.create',
    exportPermission: 'accounting.read',
    fields: [
      { label: 'Clé de pièce (regroupe les lignes d’une écriture)', required: true },
      { label: 'Journal', required: true },
      { label: 'Date', required: true },
      { label: 'Libellé de l’écriture', required: true },
      { label: 'Compte', required: true },
      { label: 'Débit', required: false },
      { label: 'Crédit', required: false },
      { label: 'Libellé de ligne', required: false },
      { label: 'Référence de la pièce', required: false },
      { label: 'Devise', required: false },
      { label: 'Tiers', required: false },
    ],
  },
  partners: {
    importType: 'partners',
    exportType: 'partners',
    importLabel: 'Importer des tiers',
    exportLabel: 'Exporter les tiers',
    importTitle: 'Import de tiers',
    importEffect: 'Crée des fiches clients et fournisseurs à partir d’un fichier CSV.',
    importPermission: 'partners.create',
    exportPermission: 'partners.read',
    fields: [
      { label: 'Code', required: true },
      { label: 'Nom', required: true },
      { label: 'Pays', required: true },
      { label: 'Raison sociale', required: false },
      { label: 'Client (oui/non)', required: false },
      { label: 'Fournisseur (oui/non)', required: false },
      { label: 'Identifiant fiscal', required: false },
      { label: 'Numéro d’immatriculation', required: false },
      { label: 'E-mail', required: false },
      { label: 'Téléphone', required: false },
      { label: 'Ville', required: false },
      { label: 'Adresse', required: false },
      { label: 'Devise par défaut', required: false },
    ],
  },
  balance: {
    importType: null,
    exportType: 'reporting.balance',
    importLabel: '',
    exportLabel: 'Exporter la balance',
    importTitle: '',
    importEffect: '',
    importPermission: '',
    exportPermission: 'reporting.read',
    fields: [],
  },
  ledger: {
    importType: null,
    exportType: 'reporting.ledger',
    importLabel: '',
    exportLabel: 'Exporter le grand livre',
    importTitle: '',
    importEffect: '',
    importPermission: '',
    exportPermission: 'reporting.read',
    fields: [],
  },
  assets: {
    importType: null,
    exportType: null,
    importLabel: 'Importer des immobilisations',
    exportLabel: 'Exporter les immobilisations',
    importTitle: '',
    importEffect: '',
    importPermission: 'assets.read',
    exportPermission: 'assets.read',
    fields: [],
  },
  treasury: {
    importType: null,
    exportType: null,
    importLabel: 'Importer des opérations',
    exportLabel: 'Exporter les opérations',
    importTitle: '',
    importEffect: '',
    importPermission: 'treasury.read',
    exportPermission: 'treasury.read',
    fields: [],
  },
};
