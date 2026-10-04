import { ErrorCatalog } from '../../../core/errors/user-error';
import { ContextualTransfer } from '../../transfers/contextual-transfer';

/** Which ledger a screen shows (route data `ledger`). */
export type LedgerMode = 'account' | 'partner';

/** URL of the ledger screens: readable, shareable, set by the record they come from. */
export const LEDGER_PARAM = {
  account: 'compte',
  partner: 'tiers',
  fiscalYear: 'exercice',
  descendants: 'sous-comptes',
  page: 'page',
} as const;

export const LEDGER_PATHS: Readonly<Record<LedgerMode, string>> = {
  account: 'analyse/grand-livre',
  partner: 'analyse/grand-livre-auxiliaire',
};

/** Reporting's errors, by code. */
export const LEDGER_ERRORS: ErrorCatalog = {
  reporting_scope_required: {
    title: 'Choisissez un exercice.',
    message: 'Le grand livre se lit sur un exercice de la société.',
  },
  reporting_scope_invalid: {
    title: 'Cet exercice ne convient pas à ce rapport.',
    message: 'Choisissez un autre exercice.',
  },
  not_found: {
    title: 'Ce compte ou ce tiers n’existe pas ou plus dans cette société.',
    message: 'Choisissez-en un autre.',
  },
};

/** Export of an account's ledger (`reporting.ledger`): the account and the fiscal year. */
export const LEDGER_TRANSFER: ContextualTransfer = {
  importType: null,
  exportType: 'reporting.ledger',
  importPermission: '',
  exportPermission: 'reporting.read',
  importLabel: '',
  exportLabel: 'Exporter le grand livre',
  importTitle: '',
  importEffect: '',
  creationKey: '',
  countLabel: (count) => `${count} lignes`,
  fieldLabels: {},
  backLabel: 'Retour au grand livre',
};
