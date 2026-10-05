import { ErrorCatalog } from '../../../core/errors/user-error';
import { StatusLook } from '../../accounting/accounting-presentation';
import { LETTERING_ERRORS } from '../../accounting/lettering/lettering-presentation';
import {
  Direction,
  ProposalCriterion,
  Reconciliation,
  StatementLineStatus,
} from '../data-access/reconciliation-models';

/**
 * Words and look of the bank reconciliation's values (the API's enums) and messages of its
 * error codes (V2.1, lots A6, A6.1). Labels only: the proposals, the amounts, the differences
 * and the decisions are always the server's.
 */

/** State of a bank line (feminine: « une ligne »). */
export const LINE_STATUS: Readonly<Record<StatementLineStatus, StatusLook>> = {
  unreconciled: { label: 'Non rapprochée', tone: 'warning', icon: 'clock' },
  reconciled: { label: 'Rapprochée', tone: 'success', icon: 'check' },
  excluded: { label: 'Exclue', tone: 'neutral', icon: 'lock' },
};

/** State of a reconciliation (masculine: « un rapprochement »). */
export const RECONCILIATION_STATUS: Readonly<Record<Reconciliation['status'], StatusLook>> = {
  active: { label: 'Rapprochement actif', tone: 'success', icon: 'check' },
  cancelled: { label: 'Rapprochement annulé', tone: 'neutral', icon: 'reverse' },
};

/** State of the lettering a confirmation created (Accounting's statuses, A4). */
export const LETTERING_STATE: Readonly<Record<string, StatusLook>> = {
  active: { label: 'Lettrage actif', tone: 'success', icon: 'check' },
  cancelled: { label: 'Lettrage annulé', tone: 'neutral', icon: 'reverse' },
};

export const DIRECTIONS: Readonly<Record<Direction, string>> = {
  inflow: 'Entrée',
  outflow: 'Sortie',
};

/** The facts a proposal rests on, in words (the server lists them; there is no score). */
export const CRITERIA: Readonly<Record<ProposalCriterion, string>> = {
  same_account: 'Même compte de trésorerie',
  same_direction: 'Même sens',
  exact_amount: 'Montant identique',
  only_candidate: 'Seule correspondance possible sur le compte',
  same_reference: 'Même référence',
};

export function criterionLabel(code: string): string {
  return CRITERIA[code as ProposalCriterion] ?? code;
}

/** The lines shown (`vue` of the URL): one API status per view, and the proposals. */
export type ReconciliationView = 'a-rapprocher' | 'propositions' | 'rapprochees' | 'exclues';
export const VIEW_STATUS: Readonly<
  Record<Exclude<ReconciliationView, 'propositions'>, StatementLineStatus>
> = {
  'a-rapprocher': 'unreconciled',
  rapprochees: 'reconciled',
  exclues: 'excluded',
};

/** Errors of the bank reconciliation, by their stable code (backend apps/treasury), and the
 * lettering's (a confirmation that settles an invoice letters it through Accounting). */
export const RECONCILIATION_ERRORS: ErrorCatalog = {
  ...LETTERING_ERRORS,
  treasury_reconciliation_proposal_stale: {
    title: 'Cette proposition n’est plus valable.',
    message:
      'La ligne, l’opération ou la facture a changé entre-temps. Les propositions ont été rechargées : vérifiez puis confirmez à nouveau.',
    help: 'Le serveur recalcule chaque proposition au moment de la confirmer. Rien n’a été rapproché.',
  },
  treasury_reconciliation_cancelled: {
    title: 'Ce rapprochement est déjà annulé.',
    message: 'La ligne a été rechargée.',
  },
  treasury_line_not_reconcilable: {
    title: 'Cette ligne n’est plus à rapprocher.',
    message: 'Elle a été rapprochée ou exclue entre-temps. La liste a été rechargée.',
  },
  treasury_operation_already_reconciled: {
    title: 'L’opération est déjà rapprochée.',
    message:
      'Elle a été rapprochée d’une autre ligne entre-temps. Les propositions ont été rechargées.',
  },
  treasury_reconciliation_mismatch: {
    title: 'L’opération ne correspond plus à la ligne.',
    message: 'Les propositions ont été rechargées.',
  },
  not_found: {
    title: 'Cet élément n’existe pas dans cette société.',
    message: 'La liste a été rechargée.',
  },
};

/** Codes after which what the screen shows is stale: read the server again. */
export const STALE_CODES: ReadonlySet<string> = new Set([
  'treasury_reconciliation_proposal_stale',
  'treasury_reconciliation_cancelled',
  'treasury_line_not_reconcilable',
  'treasury_operation_already_reconciled',
  'treasury_reconciliation_mismatch',
  'accounting_lettering_line_lettered',
  'accounting_lettering_line_not_posted',
]);
