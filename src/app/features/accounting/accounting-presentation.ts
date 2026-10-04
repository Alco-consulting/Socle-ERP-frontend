import { FieldMessageOverrides } from '../../core/errors/field-errors';
import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import {
  AccountType,
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
