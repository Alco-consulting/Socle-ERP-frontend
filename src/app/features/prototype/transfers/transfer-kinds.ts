/**
 * PROTOTYPE — the « Actions ▾ » import/export of the domains still planned (reports, fixed
 * assets, treasury). Every kind names exactly one operation of one domain; there is no
 * generic « Import / Export » screen. The real domains describe theirs with
 * `features/transfers` (Tiers, Écritures). An operation the API V1 does not offer (fixed
 * assets, treasury operations) is shown disabled with the reason.
 */

export interface TransferKind {
  /** API type, or `null` when the API V1 has no such operation. */
  readonly importType: string | null;
  readonly exportType: string | null;
  /** « Importer des immobilisations » */
  readonly importLabel: string;
  /** « Exporter la balance » */
  readonly exportLabel: string;
  /** Permissions on top of `imports_exports.create` / `imports_exports.export`. */
  readonly importPermission: string;
  readonly exportPermission: string;
}

export type TransferKindId = 'balance' | 'ledger' | 'assets' | 'treasury';

/** Shown under an operation the API does not offer yet. */
export const UNAVAILABLE_REASON = 'Pas encore proposé par l’API (V1)';

export const TRANSFER_KINDS: Readonly<Record<TransferKindId, TransferKind>> = {
  balance: {
    importType: null,
    exportType: 'reporting.balance',
    importLabel: '',
    exportLabel: 'Exporter la balance',
    importPermission: '',
    exportPermission: 'reporting.read',
  },
  ledger: {
    importType: null,
    exportType: 'reporting.ledger',
    importLabel: '',
    exportLabel: 'Exporter le grand livre',
    importPermission: '',
    exportPermission: 'reporting.read',
  },
  assets: {
    importType: null,
    exportType: null,
    importLabel: 'Importer des immobilisations',
    exportLabel: 'Exporter les immobilisations',
    importPermission: 'assets.read',
    exportPermission: 'assets.read',
  },
  treasury: {
    importType: null,
    exportType: null,
    importLabel: 'Importer des opérations',
    exportLabel: 'Exporter les opérations',
    importPermission: 'treasury.read',
    exportPermission: 'treasury.read',
  },
};
