import { FieldMessageOverrides } from '../../../core/errors/field-errors';
import { ErrorCatalog } from '../../../core/errors/user-error';
import { ContextualTransfer } from '../../transfers/contextual-transfer';
import { StatusLook } from '../accounting-presentation';
import { EntryStatus } from '../data-access/accounting-models';
import { EntryKind, RoundingMode } from '../data-access/entry-models';

/**
 * Words and look of the entries' values (the API's enums) and messages of its error codes.
 * Labels only: no state, period, rate or balance is ever decided here.
 */

/** `EntryStatus` (feminine: « une écriture »). */
export const ENTRY_STATUS: Readonly<Record<EntryStatus, StatusLook>> = {
  draft: { label: 'Brouillon', tone: 'neutral', icon: 'edit' },
  submitted: { label: 'Soumise', tone: 'warning', icon: 'clock' },
  validated: { label: 'Validée', tone: 'success', icon: 'check' },
  locked: { label: 'Verrouillée', tone: 'primary', icon: 'lock' },
};

export const ENTRY_STATUSES: readonly EntryStatus[] = ['draft', 'submitted', 'validated', 'locked'];

/** The states, in the server's order (read-only indicator). */
export const ENTRY_WORKFLOW: readonly { id: EntryStatus; label: string }[] = ENTRY_STATUSES.map(
  (id) => ({ id, label: ENTRY_STATUS[id].label }),
);

export const ENTRY_KINDS: Readonly<Record<EntryKind, string>> = {
  standard: 'Écriture',
  reversal: 'Contrepassation',
  correction: 'Correction',
};

/** `rounding` of the API (needed by the server for some currencies). */
export const ROUNDING_MODES: readonly { id: RoundingMode; label: string }[] = [
  { id: 'half_up', label: 'Au plus proche (0,5 vers le haut)' },
  { id: 'half_even', label: 'Au plus proche (0,5 vers le chiffre pair)' },
  { id: 'half_down', label: 'Au plus proche (0,5 vers le bas)' },
  { id: 'up', label: 'En s’éloignant de zéro' },
  { id: 'down', label: 'Vers zéro' },
  { id: 'ceiling', label: 'Vers le haut' },
  { id: 'floor', label: 'Vers le bas' },
];

/** « 28/09/2026 » from an ISO date of the API (no date arithmetic). */
export function isoDay(iso: string | null): string {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

/** Errors of the entries, by their stable code (backend apps/accounting, documents). */
export const ENTRY_ERRORS: ErrorCatalog = {
  accounting_entry_unbalanced: {
    title: 'L’écriture n’est pas équilibrée.',
    message: 'Le total des débits doit être égal au total des crédits.',
    help: 'Corrigez un montant ou ajoutez la ligne manquante, puis recommencez.',
  },
  accounting_entry_empty: {
    title: 'L’écriture ne contient aucun montant.',
    message: 'Saisissez au moins une ligne au débit et une ligne au crédit.',
  },
  accounting_entry_lines_required: {
    title: 'Les lignes doivent être renvoyées avec ce changement.',
    message:
      'Un changement de journal, de date, de devise ou d’arrondi s’enregistre avec les lignes.',
  },
  accounting_line_one_side: {
    title: 'Une ligne porte à la fois un débit et un crédit.',
    message: 'Chaque ligne porte un montant au débit ou au crédit, pas les deux.',
  },
  accounting_precision_exceeded: {
    title: 'Un montant a trop de décimales pour cette devise.',
    message: 'Réduisez le nombre de décimales du montant signalé.',
  },
  accounting_line_rounds_to_zero: {
    title: 'Un montant devient nul une fois arrondi.',
    message: 'Saisissez un montant plus grand sur la ligne signalée.',
  },
  accounting_rounding_required: {
    title: 'Cette devise demande un mode d’arrondi.',
    message: 'Choisissez un arrondi dans « Informations avancées ».',
  },
  accounting_period_closed: {
    title: 'La période de cette date est clôturée.',
    message: 'Choisissez une date dans une période ouverte.',
  },
  accounting_period_not_found: {
    title: 'Aucune période ne couvre cette date.',
    message: 'Choisissez une date dans un exercice ouvert de la société.',
  },
  accounting_fiscal_year_closed: {
    title: 'L’exercice de cette date est clôturé.',
    message: 'Choisissez une date dans un exercice ouvert.',
  },
  accounting_account_inactive: {
    title: 'Un compte choisi est inactif.',
    message: 'Choisissez un compte actif sur la ligne signalée.',
  },
  accounting_account_not_postable: {
    title: 'Un compte choisi n’accepte pas d’écritures.',
    message: 'Choisissez un compte imputable sur la ligne signalée.',
  },
  accounting_journal_inactive: {
    title: 'Le journal choisi est inactif.',
    message: 'Choisissez un journal actif.',
  },
  accounting_company_inactive: {
    title: 'La société est désactivée.',
    message: 'Aucune écriture ne peut y être enregistrée.',
  },
  accounting_tax_base_invalid: {
    title: 'La base taxable saisie est refusée.',
    message: 'Corrigez la base taxable de la ligne signalée.',
  },
  tax_inactive: {
    title: 'Une taxe choisie est inactive.',
    message: 'Choisissez une autre taxe, ou aucune, sur la ligne signalée.',
  },
  currency_inactive: {
    title: 'La devise choisie est inactive.',
    message: 'Choisissez une autre devise.',
  },
  accounting_invalid_transition: {
    title: 'Cette action n’est pas possible dans l’état actuel de l’écriture.',
    message: 'Son état a peut-être changé entre-temps : la fiche a été rechargée.',
  },
  accounting_entry_not_editable: {
    title: 'Cette écriture ne peut pas être modifiée.',
    message:
      'Seul un brouillon saisi manuellement se modifie ; une contrepassation ne se modifie pas.',
  },
  accounting_entry_not_reversible: {
    title: 'Cette écriture ne peut pas être contrepassée.',
    message:
      'Seule une écriture validée ou verrouillée, qui n’est pas elle-même une contrepassation, peut l’être.',
  },
  accounting_entry_already_reversed: {
    title: 'Cette écriture a déjà été contrepassée.',
    message: 'Une écriture ne se contrepasse qu’une fois.',
  },
  accounting_entry_number_exists: {
    title: 'Le numéro attribué existe déjà dans ce journal.',
    message: 'Réessayez ; si le problème persiste, contactez l’administrateur.',
  },
  accounting_entry_in_use: {
    title: 'Ce brouillon ne peut pas être supprimé.',
    message: 'Il est lié à une autre opération de la société.',
  },
  not_found: {
    title: 'Cette écriture n’existe pas ou plus dans cette société.',
    message: 'Revenez à la liste des écritures.',
  },
  document_resource_frozen: {
    title: 'Les pièces de cette écriture ne changent plus.',
    message: 'Une pièce se joint tant que l’écriture est un brouillon.',
  },
  document_file_rejected: {
    title: 'Ce fichier est refusé.',
    message: 'Vérifiez son format et sa taille, puis recommencez.',
  },
  document_not_available: {
    title: 'Cette pièce n’est plus disponible.',
    message: 'Elle a été supprimée ou remplacée.',
  },
  document_content_missing: {
    title: 'Le fichier de cette pièce est introuvable.',
    message: 'Contactez l’administrateur.',
  },
  storage_unavailable: {
    title: 'Le stockage des pièces est indisponible.',
    message: 'Réessayez dans un instant.',
  },
};

/** Field codes of a `validation_error` on the entry's own fields. */
export const ENTRY_FIELD_MESSAGES: FieldMessageOverrides = {
  journal: { unknown: 'Journal introuvable dans cette société.' },
  currency: { unknown: 'Devise inconnue.' },
  account: { unknown: 'Compte introuvable dans cette société.' },
  partner: { unknown: 'Tiers introuvable dans cette société.' },
  tax: { unknown: 'Taxe introuvable dans cette société.' },
  description: { max_length: '255 caractères au maximum.' },
  document_reference: { max_length: '64 caractères au maximum.' },
};

/** Import of entries, contextual to Comptabilité › Écritures (API type `accounting.entries`). */
export const ENTRY_TRANSFER: ContextualTransfer = {
  importType: 'accounting.entries',
  exportType: null, // the API V1 has no export of entries
  importPermission: 'accounting.create',
  exportPermission: 'accounting.read',
  importLabel: 'Importer des écritures',
  exportLabel: 'Exporter les écritures',
  importTitle: 'Import d’écritures',
  importEffect:
    'Crée des écritures en brouillon à partir d’un fichier CSV ; elles restent à valider.',
  creationKey: 'entries',
  countLabel: (count) => `${count} écriture${count > 1 ? 's' : ''}`,
  backLabel: 'Retour aux écritures',
  fieldLabels: {
    entry_key: 'Clé de pièce (regroupe les lignes d’une écriture)',
    journal: 'Journal (code)',
    entry_date: 'Date',
    description: 'Libellé de l’écriture',
    document_reference: 'Référence de la pièce',
    currency: 'Devise',
    account: 'Compte (code)',
    debit: 'Débit',
    credit: 'Crédit',
    label: 'Libellé de ligne',
    partner: 'Tiers (code)',
  },
};
