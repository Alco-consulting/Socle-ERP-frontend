import { ErrorCatalog } from '../../../core/errors/user-error';
import { StatusLook } from '../accounting-presentation';
import { DueDateRule, DueItemStatus, DueRole } from '../data-access/due-models';

/**
 * Words and look of the due dates' values (the API's enums) and messages of their error codes
 * (V2.1, lot A5). Labels only: the dates, amounts and states are always the server's.
 */

/** State of an installment (feminine: « une échéance »). */
export const DUE_STATUS: Readonly<Record<DueItemStatus, StatusLook>> = {
  open: { label: 'Ouverte', tone: 'warning', icon: 'clock' },
  partial: { label: 'Partiellement réglée', tone: 'info', icon: 'group' },
  settled: { label: 'Réglée', tone: 'success', icon: 'check' },
};

export const DUE_STATUSES: readonly DueItemStatus[] = ['open', 'partial', 'settled'];

export const DUE_ROLES: Readonly<Record<DueRole, string>> = {
  customer: 'Client',
  supplier: 'Fournisseur',
};

/** A payment term's line, in words (« 30 j », « 30 j fin de mois », « fin de mois + 10 j »). */
export function ruleLabel(days: number, rule: DueDateRule): string {
  switch (rule) {
    case 'end_of_month':
      return `${days} j fin de mois`;
    case 'end_of_month_then_days':
      return days ? `fin de mois + ${days} j` : 'fin de mois';
    default:
      return days ? `${days} j` : 'immédiat';
  }
}

/** Why a line has no due dates (`details.reason` of `accounting_due_line_not_eligible`). */
export const INELIGIBLE_REASONS: Readonly<Record<string, string>> = {
  not_posted: 'l’écriture n’est pas validée',
  no_partner: 'la ligne n’a pas de tiers',
  not_collective_account: 'la ligne n’est pas sur le compte collectif du tiers',
  not_invoice_side: 'la ligne est un règlement ou un avoir, pas une facture',
};

/** Errors of the due dates, by their stable code (backend apps/accounting, partners). */
export const DUE_ERRORS: ErrorCatalog = {
  accounting_due_line_not_eligible: {
    title: 'Une ligne ne peut pas recevoir d’échéances.',
    message:
      'Seule une facture validée d’un tiers, sur son compte collectif, reçoit des échéances.',
  },
  accounting_due_payment_term_missing: {
    title: 'Le tiers n’a pas de condition de paiement.',
    message:
      'Renseignez la condition de paiement du tiers (client ou fournisseur), puis recommencez.',
  },
  payment_term_inactive: {
    title: 'La condition de paiement est désactivée.',
    message: 'Choisissez une condition active, ou réactivez-la.',
  },
  accounting_due_schedule_exists: {
    title: 'Cette ligne a déjà ses échéances.',
    message: 'La liste a été rechargée. Pour les calculer à nouveau, utilisez « Recalculer ».',
  },
  accounting_due_nothing_to_schedule: {
    title: 'Aucune ligne à échéancer.',
    message: 'Toutes les factures de cette écriture ont déjà leurs échéances.',
  },
  accounting_account_not_letterable: {
    title: 'Le compte de la ligne n’est pas lettrable.',
    message: 'Ses échéances ne pourraient pas être réglées : rendez le compte lettrable.',
  },
  not_found: {
    title: 'Cette échéance n’existe pas dans cette société.',
    message: 'Revenez à la liste des échéances.',
  },
};

/** Codes after which the list shown is stale: read it again, drop the selection. */
export const DUE_STALE_CODES: ReadonlySet<string> = new Set(['accounting_due_schedule_exists']);
