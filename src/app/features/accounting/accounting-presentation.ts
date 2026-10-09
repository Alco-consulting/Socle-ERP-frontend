import { FieldMessageOverrides } from '../../core/errors/field-errors';
import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import {
  AccountType,
  DetailedType,
  ActiveInactive,
  JournalType,
  OpenClosed,
} from './data-access/accounting-models';

/**
 * Words and look of the values the API gives (its enums). Labels only: no state, type or
 * class is ever decided here.
 */

export interface StatusLook {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

export const RECORD_STATUS: Readonly<Record<ActiveInactive, StatusLook>> = {
  active: { label: 'Actif', tone: 'success', icon: 'check' },
  inactive: { label: 'Inactif', tone: 'neutral', icon: 'lock' },
};

/** Fiscal years (masculine) and periods (feminine). */
export const FISCAL_YEAR_STATUS: Readonly<Record<OpenClosed, StatusLook>> = {
  open: { label: 'Ouvert', tone: 'success', icon: 'check' },
  closed: { label: 'Clôturé', tone: 'primary', icon: 'lock' },
};

export const PERIOD_STATUS: Readonly<Record<OpenClosed, StatusLook>> = {
  open: { label: 'Ouverte', tone: 'success', icon: 'check' },
  closed: { label: 'Clôturée', tone: 'primary', icon: 'lock' },
};

/** `journal_type` of the API. */
export const JOURNAL_TYPES: readonly { id: JournalType; label: string }[] = [
  { id: 'general', label: 'Opérations diverses' },
  { id: 'sales', label: 'Ventes' },
  { id: 'purchase', label: 'Achats' },
  { id: 'bank', label: 'Banque' },
  { id: 'cash', label: 'Caisse' },
  { id: 'other', label: 'Autre' },
];

/** `account_type` of the API. */
export const ACCOUNT_TYPES: readonly { id: AccountType; label: string }[] = [
  { id: 'asset', label: 'Actif' },
  { id: 'liability', label: 'Passif' },
  { id: 'equity', label: 'Capitaux propres' },
  { id: 'income', label: 'Produit' },
  { id: 'expense', label: 'Charge' },
  { id: 'other', label: 'Autre' },
];

/** `detailed_type` of the API, the source chart's words, with the nature it belongs to. */
export const DETAILED_TYPES: readonly { id: DetailedType; label: string; nature: AccountType }[] = [
  { id: 'equity', label: 'Capitaux propres', nature: 'equity' },
  { id: 'equity_unaffected', label: 'Bénéfices de l’exercice en cours', nature: 'equity' },
  { id: 'liability_current', label: 'Dettes à court terme', nature: 'liability' },
  { id: 'liability_payable', label: 'Fournisseur', nature: 'liability' },
  { id: 'asset_fixed', label: 'Actifs immobilisés', nature: 'asset' },
  { id: 'asset_current', label: 'Actifs circulants', nature: 'asset' },
  { id: 'asset_cash', label: 'Banque et espèces', nature: 'asset' },
  { id: 'asset_receivable', label: 'Client', nature: 'asset' },
  { id: 'expense', label: 'Charges', nature: 'expense' },
  { id: 'income', label: 'Revenus', nature: 'income' },
  { id: 'income_other', label: 'Autres produits', nature: 'income' },
  { id: 'off_balance', label: 'Hors bilan', nature: 'other' },
];

/** The account's type in words: its detailed type when it has one, else its nature. */
export function accountTypeText(account: {
  readonly account_type: AccountType;
  readonly detailed_type: DetailedType | '';
}): string {
  const detailed = DETAILED_TYPES.find((item) => item.id === account.detailed_type);
  return detailed?.label ?? accountTypeLabel(account.account_type);
}

export function journalTypeLabel(type: JournalType): string {
  return JOURNAL_TYPES.find((item) => item.id === type)?.label ?? type;
}

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPES.find((item) => item.id === type)?.label ?? type;
}

/** « 01/01/2026 → 31/12/2026 » from two ISO dates of the API (no date arithmetic). */
export function dateRange(start: string, end: string): string {
  const day = (iso: string) => iso.split('-').reverse().join('/');
  return `${day(start)} → ${day(end)}`;
}

/** Errors of the accounting referential, by their stable code (backend contract.md). */
export const ACCOUNTING_REFERENTIAL_ERRORS: ErrorCatalog = {
  accounting_account_detailed_type_mismatch: {
    title: 'Ce type détaillé ne correspond pas à la nature du compte.',
    message: 'Choisissez un type détaillé de cette nature, ou changez la nature.',
  },
  accounting_account_currency_mismatch: {
    title: 'Ce compte a déjà des écritures dans une autre devise.',
    message: 'Laissez la devise vide (toutes devises) ou choisissez celle de ses écritures.',
  },
  accounting_account_letterings_exist: {
    title: 'Ce compte a des lettrages actifs.',
    message: 'Délettrez-les (Comptabilité › Lettrage) avant de retirer le lettrage du compte.',
  },
  accounting_journal_code_exists: {
    title: 'Ce code est déjà utilisé par un autre journal.',
    message: 'Choisissez un autre code.',
  },
  accounting_journal_numbering_in_use: {
    title: 'La numérotation de ce journal ne peut plus changer.',
    message: 'Des écritures ont déjà été numérotées dans ce journal.',
  },
  accounting_account_code_exists: {
    title: 'Ce code est déjà utilisé par un autre compte.',
    message: 'Choisissez un autre code.',
  },
  accounting_account_cycle: {
    title: 'Ce compte ne peut pas être rattaché à ce parent.',
    message: 'Un compte ne peut pas être placé sous l’un de ses propres sous-comptes.',
  },
  accounting_account_inactive: {
    title: 'Le compte choisi est inactif.',
    message: 'Choisissez un compte actif.',
  },
  currency_inactive: {
    title: 'La devise choisie est inactive.',
    message: 'Choisissez une autre devise, ou aucune.',
  },
  not_found: {
    title: 'Cet élément n’existe pas ou plus dans cette société.',
    message: 'Revenez à la liste.',
  },
};

export const ACCOUNTING_FIELD_MESSAGES: FieldMessageOverrides = {
  default_currency: { unknown: 'Devise inconnue.' },
  parent: { unknown: 'Compte parent introuvable.' },
  sequence_padding: {
    max_value: '12 chiffres au plus.',
    min_value: '1 chiffre au moins.',
  },
};
