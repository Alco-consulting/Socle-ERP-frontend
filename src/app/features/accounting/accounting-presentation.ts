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

/** `journal_type` of the API, in Odoo's order (no « Général » nor « Autre »: note 0033). */
export const JOURNAL_TYPES: readonly { id: JournalType; label: string }[] = [
  { id: 'sales', label: 'Ventes' },
  { id: 'purchase', label: 'Achats' },
  { id: 'bank', label: 'Banque' },
  { id: 'cash', label: 'Caisse' },
  { id: 'general', label: 'Opérations diverses' },
];

/**
 * The « Compte » of a journal (Odoo's « Compte par défaut »), said simply, with what it is for
 * each type; a journal of miscellaneous operations has none.
 */
export const JOURNAL_ACCOUNT_FIELDS: Readonly<
  Partial<Record<JournalType, { label: string; hint: string }>>
> = {
  sales: { label: 'Compte', hint: 'Un compte de produits, ex. 701100 Ventes de marchandises.' },
  purchase: { label: 'Compte', hint: 'Un compte de charges, ex. 601100 Achats de marchandises.' },
  bank: { label: 'Compte', hint: 'Le compte de la banque dans le plan, ex. 521100.' },
  cash: { label: 'Compte', hint: 'Le compte de la caisse dans le plan, ex. 571100.' },
};

/** `account_type` of the API. */
export const ACCOUNT_TYPES: readonly { id: AccountType; label: string }[] = [
  { id: 'asset', label: 'Actif' },
  { id: 'liability', label: 'Passif' },
  { id: 'equity', label: 'Capitaux propres' },
  { id: 'income', label: 'Produit' },
  { id: 'expense', label: 'Charge' },
  { id: 'other', label: 'Autre' },
];

/**
 * The account's type as Odoo lists it: its sections (Bilan, Pertes & Profits), its groups
 * and its words, in that order. The nature of each type is the server's (\`DETAILED_NATURE\`).
 */
export const TYPE_SECTIONS: readonly {
  readonly label: string | null;
  readonly groups: readonly {
    readonly label: string;
    readonly types: readonly { readonly id: DetailedType; readonly label: string }[];
  }[];
}[] = [
  {
    label: 'Bilan',
    groups: [
      {
        label: 'Immobilisations',
        types: [
          { id: 'asset_receivable', label: 'Client' },
          { id: 'asset_cash', label: 'Banque et espèces' },
          { id: 'asset_current', label: 'Actifs circulants' },
          { id: 'asset_non_current', label: 'Actif immobilisé' },
          { id: 'asset_prepayments', label: 'Acomptes' },
          { id: 'asset_fixed', label: 'Immobilisations' },
        ],
      },
      {
        label: 'Passifs',
        types: [
          { id: 'liability_payable', label: 'Fournisseur' },
          { id: 'liability_credit_card', label: 'Carte de crédit' },
          { id: 'liability_current', label: 'Dettes à court terme' },
          { id: 'liability_non_current', label: 'Passif immobilisé' },
        ],
      },
      {
        label: 'Fonds propres',
        types: [
          { id: 'equity', label: 'Fonds propres' },
          { id: 'equity_unaffected', label: 'Bénéfices de l’exercice en cours' },
        ],
      },
    ],
  },
  {
    label: 'Pertes & Profits',
    groups: [
      {
        label: 'Produits',
        types: [
          { id: 'income', label: 'Produits' },
          { id: 'income_other', label: 'Autres produits' },
        ],
      },
      {
        label: 'Charge',
        types: [
          { id: 'expense', label: 'Charges' },
          { id: 'expense_depreciation', label: 'Amortissement' },
          { id: 'expense_direct_cost', label: 'Coût des produits' },
        ],
      },
    ],
  },
  {
    label: null,
    groups: [{ label: 'Autre', types: [{ id: 'off_balance', label: 'Hors bilan' }] }],
  },
];

/** Every type, flat, in Odoo's order. */
export const DETAILED_TYPES: readonly { id: DetailedType; label: string }[] = TYPE_SECTIONS.flatMap(
  (section) => section.groups.flatMap((group) => group.types),
);

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
  accounting_journal_code_in_use: {
    title: 'Le code court de ce journal ne peut plus changer.',
    message: 'Des écritures validées portent déjà un numéro qui commence par ce code.',
  },
  accounting_fiscal_year_overlap: {
    title: 'Ces dates chevauchent un autre exercice de la société.',
    message: 'Choisissez des dates après l’exercice précédent.',
  },
  accounting_fiscal_year_code_exists: {
    title: 'Un exercice de la société porte déjà ce code.',
    message: 'Choisissez un autre code.',
  },
  accounting_fiscal_year_has_periods: {
    title: 'Cet exercice a déjà ses périodes.',
    message: 'Rechargez la page pour les voir.',
  },
  accounting_period_overlap: {
    title: 'Ces dates chevauchent une autre période.',
    message: 'Les périodes d’un exercice ne se chevauchent pas.',
  },
  accounting_journal_template_not_found: {
    title: 'Aucun journal usuel n’est connu pour le plan comptable de la société.',
    message: 'Créez les journaux un par un avec « Nouveau journal ».',
  },
  accounting_account_not_postable: {
    title: 'Ce compte ne reçoit pas d’écritures.',
    message: 'Choisissez un compte imputable (sans sous-compte).',
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
