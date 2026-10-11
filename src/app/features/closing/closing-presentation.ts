import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import { CLOSING_CHECKS } from '../accounting/dashboard/dashboard-presentation';
import {
  CheckLevel,
  ClosingRun,
  RunStatus,
  StepCode,
  StepStatus,
} from './data-access/closing-models';

/** Words and look of the values the closing API gives. Labels only: no state is decided here. */

export interface Look {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

export const RUN_STATUS: Readonly<Record<RunStatus, Look>> = {
  in_progress: { label: 'En cours', tone: 'info', icon: 'clock' },
  closed: { label: 'Clôturée', tone: 'primary', icon: 'lock' },
  completed: { label: 'Terminée', tone: 'success', icon: 'check' },
  cancelled: { label: 'Abandonnée', tone: 'neutral', icon: 'close' },
  reopened: { label: 'Rouverte', tone: 'warning', icon: 'refresh' },
};

export const STEP_STATUS: Readonly<Record<StepStatus, Look>> = {
  pending: { label: 'À faire', tone: 'neutral', icon: 'clock' },
  succeeded: { label: 'Réussie', tone: 'success', icon: 'check' },
  failed: { label: 'Échouée', tone: 'danger', icon: 'alert-circle' },
  skipped: { label: 'Sans objet', tone: 'neutral', icon: 'check' },
};

export const PERIOD_STATUS: Readonly<Record<'open' | 'closed', Look>> = {
  open: { label: 'Ouverte', tone: 'success', icon: 'check' },
  closed: { label: 'Clôturée', tone: 'primary', icon: 'lock' },
};

export const CHECK_LEVEL: Readonly<Record<Exclude<CheckLevel, 'ok'>, Look>> = {
  blocking: { label: 'Bloquant', tone: 'danger', icon: 'alert-circle' },
  warning: { label: 'À vérifier', tone: 'warning', icon: 'alert-triangle' },
};

/** The ten steps, in the server's order. */
export const STEPS: Readonly<Record<StepCode, string>> = {
  pre_close_checks: 'Contrôles avant clôture',
  inventory: 'Inventaire et ajustements',
  depreciation: 'Amortissements',
  provisions: 'Provisions et dépréciations',
  fx: 'Écarts de change',
  tax_check: 'Contrôle des taxes',
  validation: 'Validation',
  result: 'Résultat de l’exercice',
  close: 'Clôture',
  opening: 'Ouverture de l’exercice suivant',
};

/** The button of a step (validation and close are decisions of their own). */
export const STEP_ACTIONS: Readonly<Partial<Record<StepCode, string>>> = {
  validation: 'Valider la clôture',
  close: 'Clôturer l’exercice',
};

/** Checks of the steps that the dashboard's alerts do not name. */
const STEP_CHECKS: Readonly<Record<string, string>> = {
  inventory_not_supported: 'Pas de module d’inventaire : ajustements saisis en Comptabilité',
  provisions_not_supported: 'Pas de module de provisions : provisions saisies en Comptabilité',
  tax_calendar_undefined: 'Calendrier fiscal non défini',
  opening_entry_not_generated: 'Pas d’écriture d’ouverture : aucun journal ni compte de résultat',
  opening_unclassified_accounts: 'Comptes non classés repris au bilan',
  opening_entry_exists: 'Une écriture d’ouverture existe déjà : contrepassez-la d’abord',
  next_fiscal_year_missing: 'L’exercice suivant ne commence pas au lendemain de celui-ci',
  next_opening_period_missing: 'Aucune période ne couvre le premier jour de l’exercice suivant',
  task_retries_exhausted: 'La tâche de l’étape n’a pas pu aboutir',
  task_error: 'La tâche de l’étape a échoué',
};

export function checkLabel(code: string): string {
  return STEP_CHECKS[code] ?? CLOSING_CHECKS[code] ?? `Contrôle « ${code} »`;
}

/** « 01/01/2026 → 31/12/2026 » from two ISO dates of the API (no date arithmetic). */
export function dateRange(start: string, end: string): string {
  const day = (iso: string) => iso.split('-').reverse().join('/');
  return `${day(start)} → ${day(end)}`;
}

/** « Exercice 2026 », « Période 2026-03 » — what the closing closes. */
export function runSubject(run: ClosingRun): string {
  return run.scope === 'fiscal_year'
    ? `Exercice ${run.fiscal_year.code}`
    : `Période ${run.period?.code ?? ''}`;
}

/** Errors of the closing API, by their stable code (backend contract.md). */
export const CLOSING_ERRORS: ErrorCatalog = {
  closing_run_exists: {
    title: 'Une clôture de cet exercice est déjà en cours ou faite.',
    message: 'Ouvrez-la depuis la liste des clôtures.',
  },
  closing_invalid_transition: {
    title: 'Cette action n’est pas possible dans l’état actuel de la clôture.',
    message: 'Rechargez la page : la clôture a peut-être changé.',
  },
  closing_step_out_of_order: {
    title: 'Les étapes précédentes doivent réussir d’abord.',
    message: 'Exécutez les étapes dans l’ordre.',
  },
  closing_step_invalid_transition: {
    title: 'Cette étape ne peut pas s’exécuter maintenant.',
    message: 'Rechargez la page : elle a peut-être déjà été exécutée.',
  },
  closing_fiscal_year_run_live: {
    title: 'Une autre clôture de l’exercice est en cours.',
    message: 'Abandonnez-la ou terminez-la avant de rouvrir une période.',
  },
  closing_period_run_live: {
    title: 'Cette période a sa propre clôture.',
    message: 'Rouvrez la clôture de cette période.',
  },
  closing_period_not_closed: {
    title: 'Cette période n’est pas clôturée.',
    message: 'Rechargez la page pour voir son état.',
  },
  closing_target_invalid: {
    title: 'Cette période n’appartient pas à l’exercice.',
    message: 'Choisissez une période de cet exercice.',
  },
  accounting_fiscal_year_closed: {
    title: 'L’exercice est clôturé.',
    message: 'Rouvrez d’abord l’exercice.',
  },
};
