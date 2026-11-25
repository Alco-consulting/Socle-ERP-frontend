import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import {
  Frequency,
  LineStatus,
  LoanStatus,
  PrepaymentStrategy,
  RepaymentMethod,
} from './data-access/loans-models';

/** Words and look of the loans API's values: no state is decided here. */

export interface Look {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

export const LOAN_STATUS: Readonly<Record<LoanStatus, Look>> = {
  draft: { label: 'Brouillon', tone: 'neutral', icon: 'edit' },
  active: { label: 'En cours', tone: 'primary', icon: 'check' },
  completed: { label: 'Remboursé', tone: 'success', icon: 'check' },
  cancelled: { label: 'Annulé', tone: 'neutral', icon: 'close' },
};

export const LINE_STATUS: Readonly<Record<LineStatus, string>> = {
  planned: 'À payer',
  partial: 'Payée en partie',
  paid: 'Payée',
  superseded: 'Remplacée',
};

export const FREQUENCIES: readonly { id: Frequency; label: string }[] = [
  { id: 'monthly', label: 'Mensuelle' },
  { id: 'quarterly', label: 'Trimestrielle' },
  { id: 'semiannual', label: 'Semestrielle' },
  { id: 'annual', label: 'Annuelle' },
];

export const METHODS: readonly { id: RepaymentMethod; label: string }[] = [
  { id: 'annuity', label: 'Échéances constantes' },
  { id: 'constant_principal', label: 'Capital constant' },
];

export const STRATEGIES: readonly { id: PrepaymentStrategy; label: string }[] = [
  { id: 'reduce_installment', label: 'Baisser les échéances (même durée)' },
  { id: 'reduce_duration', label: 'Raccourcir la durée (mêmes échéances)' },
];

export const FREQUENCY_MONTHS: Readonly<Record<Frequency, number>> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** `date` plus `months`, the day kept or brought back to the month's end (as the server). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + month - 1 + months;
  const target = { year: Math.floor(index / 12), month: (index % 12) + 1 };
  const last = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate();
  const kept = String(Math.min(day, last)).padStart(2, '0');
  return `${target.year}-${String(target.month).padStart(2, '0')}-${kept}`;
}

/** « Mensuelle », « Échéances constantes »: the word of a value, or the value itself. */
export function wordOf(choices: readonly { id: string; label: string }[], value: string): string {
  return choices.find((choice) => choice.id === value)?.label ?? value;
}

export const LOAN_ERRORS: ErrorCatalog = {
  loans_type_code_exists: {
    title: 'Ce code de type existe déjà.',
    message: 'Choisissez un autre code.',
  },
  loans_type_inactive: {
    title: 'Le type d’emprunt est désactivé.',
    message: 'Choisissez un type actif.',
  },
  loans_value_invalid: {
    title: 'Une valeur n’est pas valable.',
    message: 'Vérifiez les montants (décimales de la devise) et les dates.',
  },
  loans_schedule_parameters_invalid: {
    title: 'L’échéancier ne peut pas être calculé.',
    message:
      'La première échéance doit tomber une période entière après le déblocage (ex. le 15 du mois suivant pour un déblocage le 15).',
  },
  loans_negative_amortization: {
    title: 'L’échéance ne couvre pas les intérêts.',
    message: 'Augmentez le nombre d’échéances ou vérifiez le taux.',
  },
  loans_invalid_transition: {
    title: 'Cette action n’est plus possible.',
    message: 'L’emprunt a changé entre-temps : la page est rechargée.',
  },
  loans_loan_not_editable: {
    title: 'L’emprunt est activé.',
    message: 'Seul un emprunt en brouillon se modifie.',
  },
  loans_installment_out_of_order: {
    title: 'Une échéance précédente n’est pas payée.',
    message: 'Les échéances se paient dans l’ordre.',
  },
  loans_installment_invalid_transition: {
    title: 'Cette échéance est déjà payée.',
    message: 'La page est rechargée.',
  },
  loans_installments_pending: {
    title: 'Des échéances échues restent à payer.',
    message: 'Payez les échéances jusqu’à la date du remboursement anticipé, puis recommencez.',
  },
  loans_installment_partially_paid: {
    title: 'Une échéance est payée en partie.',
    message: 'Soldez-la avant le remboursement anticipé.',
  },
  loans_prepayment_exceeds_outstanding: {
    title: 'Le montant dépasse le capital restant dû.',
    message: 'Saisissez au plus le capital restant dû.',
  },
  loans_account_missing: {
    title: 'Un compte manque dans le type d’emprunt.',
    message: 'Renseignez les comptes du type, puis recommencez.',
  },
  loans_journal_missing: {
    title: 'Le type d’emprunt n’a pas de journal.',
    message: 'Choisissez un journal pour le type, puis recommencez.',
  },
  loans_journal_not_treasury: {
    title: 'Ce journal n’est ni une banque ni une caisse.',
    message: 'Choisissez un journal de banque ou de caisse.',
  },
  loans_treasury_mismatch: {
    title: 'Le journal n’est pas dans la devise de l’emprunt.',
    message: 'Choisissez une banque ou une caisse dans la même devise.',
  },
  loans_exchange_rate_changed: {
    title: 'Le taux de change a changé depuis.',
    message: 'Vérifiez les taux de la devise à cette date.',
  },
  loans_type_template_not_found: {
    title: 'Pas de types usuels pour ce pays.',
    message: 'Créez vos types un à un.',
  },
};
