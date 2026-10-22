import { ErrorCatalog } from '../../core/errors/user-error';
import { FieldMessageOverrides } from '../../core/errors/field-errors';
import { StatusLook } from '../accounting/accounting-presentation';
import {
  OperationStatus,
  OperationType,
  RecordStatus,
  RoundingMode,
  Statement,
  TreasuryAccountType,
} from './data-access/reconciliation-models';
import { RECONCILIATION_ERRORS } from './reconciliation/reconciliation-presentation';

/**
 * Words and look of the treasury's values (the API's enums) and messages of its error codes
 * (Module 6). Labels only: balances, statuses, postings, the statement's arithmetic and the
 * reconciliation are always the server's. The reconciliation's own words stay in
 * `reconciliation/reconciliation-presentation.ts` (V2.1 A6).
 */

export { DIRECTIONS, LINE_STATUS } from './reconciliation/reconciliation-presentation';

/** The server's account types (`account_type`), never a category made up here. */
export const ACCOUNT_TYPES: readonly { id: TreasuryAccountType; label: string }[] = [
  { id: 'bank', label: 'Banque' },
  { id: 'cash', label: 'Caisse' },
  { id: 'other', label: 'Autre' },
];

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPES.find((item) => item.id === type)?.label ?? type;
}

/** State of a treasury account (masculine: « un compte »). */
export const ACCOUNT_STATUS: Readonly<Record<RecordStatus, StatusLook>> = {
  active: { label: 'Actif', tone: 'success', icon: 'check' },
  inactive: { label: 'Inactif', tone: 'neutral', icon: 'lock' },
};

/** The server's operation types (`operation_type`). */
export const OPERATION_TYPES: readonly { id: OperationType; label: string }[] = [
  { id: 'deposit', label: 'Encaissement' },
  { id: 'withdrawal', label: 'Décaissement' },
  { id: 'bank_fee', label: 'Frais bancaires' },
  { id: 'transfer', label: 'Virement interne' },
  { id: 'other', label: 'Autre' },
];

export function operationTypeLabel(type: string): string {
  return OPERATION_TYPES.find((item) => item.id === type)?.label ?? type;
}

/** State of an operation (feminine: « une opération »). */
export const OPERATION_STATUS: Readonly<Record<OperationStatus, StatusLook>> = {
  draft: { label: 'Brouillon', tone: 'neutral', icon: 'edit' },
  confirmed: { label: 'Confirmée', tone: 'info', icon: 'check' },
  accounted: { label: 'Comptabilisée', tone: 'success', icon: 'book' },
  cancelled: { label: 'Annulée', tone: 'danger', icon: 'close' },
};

/** State of a statement (masculine: « un relevé »). */
export const STATEMENT_STATUS: Readonly<Record<Statement['status'], StatusLook>> = {
  open: { label: 'Ouvert', tone: 'warning', icon: 'clock' },
  closed: { label: 'Clôturé', tone: 'success', icon: 'lock' },
};

/** Rounding modes of the API (a conversion between two currencies). */
export const ROUNDING_MODES: readonly { id: RoundingMode; label: string }[] = [
  { id: 'half_up', label: 'Au plus proche (0,5 vers le haut)' },
  { id: 'half_even', label: 'Au plus proche (0,5 vers le pair)' },
  { id: 'half_down', label: 'Au plus proche (0,5 vers le bas)' },
  { id: 'up', label: 'Vers le haut (en valeur absolue)' },
  { id: 'down', label: 'Vers le bas (en valeur absolue)' },
  { id: 'ceiling', label: 'Vers le plus grand' },
  { id: 'floor', label: 'Vers le plus petit' },
];

/** Audit object types of the treasury's records (`app_label.model` of the backend). */
export const TREASURY_AUDIT_TYPES = {
  account: 'treasury.treasuryaccount',
  operation: 'treasury.treasuryoperation',
  transfer: 'treasury.treasurytransfer',
  statement: 'treasury.bankstatement',
} as const;

/** Documents resource type of an operation (registered by the backend's Treasury). */
export const OPERATION_DOCUMENTS = 'treasury.operation';

/** Errors of the treasury, by their stable code (backend apps/treasury). */
export const TREASURY_ERRORS: ErrorCatalog = {
  treasury_transfer_account_not_letterable: {
    title: 'Le compte d’un virement interne doit autoriser le lettrage.',
    message:
      'Ouvrez ce compte dans le plan comptable, cochez « Autoriser le lettrage », puis enregistrez à nouveau le modèle.',
  },
  treasury_reconcile_model_exists: {
    title: 'Un modèle de rapprochement porte déjà ce nom.',
    message: 'Choisissez un autre nom.',
  },
  ...RECONCILIATION_ERRORS,
  treasury_transaction_line: {
    title: 'Cette facture ne correspond pas.',
    message:
      'Une entrée d’argent règle une facture client, une sortie une facture fournisseur, du même partenaire.',
  },
  treasury_transaction_counterpart_missing: {
    title: 'Contrepartie manquante.',
    message: 'Choisissez une facture du partenaire, ou le compte de contrepartie.',
  },
  treasury_account_code_exists: {
    title: 'Ce code est déjà utilisé.',
    message: 'Un autre compte de trésorerie de la société porte ce code.',
  },
  treasury_account_inactive: {
    title: 'Ce compte de trésorerie est inactif.',
    message: 'Réactivez-le ou choisissez un autre compte.',
  },
  treasury_opening_balance_locked: {
    title: 'Le solde d’ouverture ne peut plus changer.',
    message: 'Des opérations sont déjà comptées sur ce compte.',
  },
  treasury_amount_invalid: {
    title: 'Ce montant n’est pas valable.',
    message: 'Un montant est strictement positif, dans les décimales de sa devise.',
  },
  treasury_direction_mismatch: {
    title: 'Le sens ne correspond pas au type d’opération.',
    message: 'Ce type d’opération fixe le sens du mouvement : changez l’un ou l’autre.',
  },
  treasury_operation_exists: {
    title: 'Cette opération a déjà été enregistrée.',
    message: 'La même demande a déjà abouti : rien n’a été créé une seconde fois.',
  },
  treasury_operation_not_editable: {
    title: 'Cette opération ne se modifie plus.',
    message: 'Seul un brouillon hors virement se modifie. La fiche a été rechargée.',
  },
  treasury_invalid_transition: {
    title: 'Cette étape n’est pas possible depuis l’état actuel.',
    message: 'La fiche a été rechargée : vérifiez l’état de l’opération.',
  },
  treasury_operation_already_accounted: {
    title: 'Cette opération est déjà comptabilisée.',
    message: 'La fiche a été rechargée.',
  },
  treasury_operation_already_corrected: {
    title: 'Cette opération a déjà une opération de correction.',
    message: 'Une opération ne se corrige qu’une fois.',
  },
  treasury_operation_reconciled: {
    title: 'Cette opération est rapprochée.',
    message: 'Annulez d’abord son rapprochement bancaire, puis l’opération.',
  },
  treasury_operation_is_transfer: {
    title: 'Cette opération fait partie d’un virement.',
    message: 'Elle change seulement avec son virement : ouvrez le virement.',
  },
  treasury_offset_account_missing: {
    title: 'Le compte de contrepartie manque.',
    message: 'Indiquez le compte de contrepartie de l’opération avant de la comptabiliser.',
  },
  treasury_ledger_account_missing: {
    title: 'Ce compte de trésorerie n’a pas de compte comptable.',
    message: 'Associez-lui un compte du plan comptable avant de comptabiliser.',
  },
  treasury_journal_missing: {
    title: 'Aucun journal pour la comptabilisation.',
    message: 'Choisissez un journal, ou associez un journal par défaut au compte de trésorerie.',
  },
  treasury_entry_already_linked: {
    title: 'Cette écriture est déjà liée à une autre opération.',
    message: 'Choisissez une autre écriture.',
  },
  treasury_entry_mismatch: {
    title: 'Cette écriture ne correspond pas à l’opération.',
    message:
      'Aucune de ses lignes ne porte le mouvement de l’opération sur le compte de trésorerie.',
  },
  treasury_transfer_same_account: {
    title: 'Un virement relie deux comptes différents.',
    message: 'Choisissez un compte de destination différent du compte d’origine.',
  },
  treasury_rounding_required: {
    title: 'Un mode d’arrondi est nécessaire.',
    message: 'Les deux comptes n’ont pas la même devise : choisissez un mode d’arrondi.',
  },
  treasury_multicurrency_posting_undefined: {
    title: 'Ce virement entre deux devises ne se comptabilise pas encore.',
    message: 'Sa règle comptable n’est pas encore définie.',
  },
  treasury_statement_exists: {
    title: 'Ce relevé existe déjà.',
    message: 'Un relevé de ce compte porte déjà cette référence.',
  },
  treasury_statement_line_exists: {
    title: 'Cette transaction est déjà dans le relevé.',
    message: 'Une ligne porte déjà cet identifiant de transaction.',
  },
  treasury_statement_closed: {
    title: 'Ce relevé est clôturé.',
    message: 'Un relevé clôturé ne change plus.',
  },
  treasury_statement_unbalanced: {
    title: 'Le relevé n’est pas équilibré.',
    message:
      'Le solde d’ouverture plus les lignes diffère du solde de clôture : vérifiez le relevé avant de le clôturer.',
  },
  not_found: {
    title: 'Cet élément n’existe pas dans cette société.',
    message: 'Revenez à la liste.',
  },
};

/** Codes after which the record shown is stale: read it again from the server. */
export const TREASURY_STALE_CODES: ReadonlySet<string> = new Set([
  'treasury_invalid_transition',
  'treasury_operation_not_editable',
  'treasury_operation_already_accounted',
  'treasury_line_not_reconcilable',
  'treasury_statement_closed',
]);

/** Field messages of the treasury's forms (DRF codes of `validation_error`). */
export const TREASURY_FIELD_MESSAGES: FieldMessageOverrides = {
  code: { max_length: '32 caractères au maximum.' },
  name: { max_length: '100 caractères au maximum.' },
  currency: { invalid: 'Devise inconnue.', does_not_exist: 'Devise inconnue.' },
  ledger_account: { unknown: 'Compte introuvable dans cette société.' },
  journal: { unknown: 'Journal introuvable dans cette société.' },
  counterparty: { unknown: 'Tiers introuvable dans cette société.' },
  offset_account: { unknown: 'Compte introuvable dans cette société.' },
  treasury_account: { unknown: 'Compte de trésorerie introuvable dans cette société.' },
  source_account: { unknown: 'Compte de trésorerie introuvable dans cette société.' },
  destination_account: { unknown: 'Compte de trésorerie introuvable dans cette société.' },
};

export { STATEMENT_TRANSFER } from './statement-transfer';
