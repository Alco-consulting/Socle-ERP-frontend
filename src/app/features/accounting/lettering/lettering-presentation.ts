import { ErrorCatalog } from '../../../core/errors/user-error';
import { StatusLook } from '../accounting-presentation';
import {
  LetteringKind,
  LetteringSide,
  LetteringStatus,
  LineLetteringStatus,
} from '../data-access/lettering-models';

/**
 * Words and look of the lettering's values (the API's enums) and messages of its error
 * codes (V2.1, lot A4). Labels only: which lines can be lettered, the amounts, the residual
 * and the proposals are always the server's.
 */

/** State of a line (feminine: « une ligne »). */
export const LINE_STATUS: Readonly<Record<LineLetteringStatus, StatusLook>> = {
  open: { label: 'Ouverte', tone: 'warning', icon: 'clock' },
  partial: { label: 'Partiellement lettrée', tone: 'info', icon: 'group' },
  lettered: { label: 'Lettrée', tone: 'success', icon: 'check' },
};

/** State of a lettering (masculine: « un lettrage »). */
export const LETTERING_STATUS: Readonly<Record<LetteringStatus, StatusLook>> = {
  active: { label: 'Actif', tone: 'success', icon: 'check' },
  cancelled: { label: 'Annulé', tone: 'neutral', icon: 'reverse' },
};

export const LETTERING_KINDS: Readonly<Record<LetteringKind, string>> = {
  manual: 'Manuel',
  automatic: 'Automatique (proposition confirmée)',
};

export const SIDES: Readonly<Record<LetteringSide, string>> = {
  debit: 'Débit',
  credit: 'Crédit',
};

/** What the line list shows (`etat` of the URL): the API's `status` filter, or all lines. */
export type LineView = 'open' | 'lettered' | 'all';
export const LINE_VIEWS: readonly { id: LineView; label: string }[] = [
  { id: 'open', label: 'À lettrer (ouvertes ou partielles)' },
  { id: 'lettered', label: 'Lettrées' },
  { id: 'all', label: 'Toutes les lignes' },
];

/** Errors of the lettering, by their stable code (backend apps/accounting). */
export const LETTERING_ERRORS: ErrorCatalog = {
  accounting_account_not_letterable: {
    title: 'Ce compte n’est pas lettrable.',
    message: 'Seules les lignes d’un compte configuré pour le lettrage peuvent être lettrées.',
    help: 'Un gestionnaire du plan comptable peut rendre le compte lettrable depuis sa fiche.',
  },
  accounting_account_letterings_exist: {
    title: 'Ce compte a des lettrages actifs.',
    message: 'Délettrez-les avant de retirer le lettrage du compte.',
  },
  accounting_lettering_selection_invalid: {
    title: 'La sélection ne permet pas un lettrage.',
    message: 'Sélectionnez au moins deux lignes différentes.',
  },
  accounting_lettering_line_not_posted: {
    title: 'Une ligne n’est pas comptabilisée.',
    message: 'Seules les lignes d’écritures validées ou verrouillées peuvent être lettrées.',
  },
  accounting_lettering_line_lettered: {
    title: 'Une ligne sélectionnée est déjà lettrée.',
    message:
      'Elle a été lettrée entre-temps. La liste a été rechargée : vérifiez puis sélectionnez à nouveau.',
  },
  accounting_lettering_accounts_differ: {
    title: 'Les lignes portent sur des comptes différents.',
    message: 'Un lettrage regroupe des lignes d’un même compte.',
  },
  accounting_lettering_partners_differ: {
    title: 'Les lignes concernent des tiers différents.',
    message: 'Un lettrage regroupe des lignes d’un même tiers, ou sans tiers.',
  },
  accounting_lettering_one_sided: {
    title: 'Les lignes sont toutes du même côté.',
    message: 'Un lettrage rapproche des lignes au débit et des lignes au crédit.',
  },
  accounting_lettering_unbalanced: {
    title: 'Le débit et le crédit sélectionnés ne sont pas égaux.',
    message: 'Changez la sélection, ou demandez un lettrage partiel : le résiduel restera ouvert.',
    help: 'L’écart n’est jamais passé en perte ou profit : aucune règle n’est configurée.',
  },
  accounting_lettering_write_off_unavailable: {
    title: 'Le passage d’un écart en perte ou profit n’est pas disponible.',
    message: 'Aucune règle n’est configurée : lettrez partiellement, le résiduel reste ouvert.',
  },
  accounting_lettering_exists: {
    title: 'Ce lettrage a déjà été enregistré.',
    message: 'La même demande a déjà abouti : rien n’a été créé une seconde fois.',
  },
  accounting_lettering_cancelled: {
    title: 'Ce lettrage est déjà annulé.',
    message: 'La fiche a été rechargée.',
  },
  accounting_lettering_not_a_proposal: {
    title: 'Ces lignes ne forment plus une proposition.',
    message: 'Les propositions ont été rechargées.',
  },
  not_found: {
    title: 'Ce lettrage n’existe pas dans cette société.',
    message: 'Revenez à la liste des lettrages.',
  },
};

/** Codes after which what the screen shows is stale: reload from the server, drop the selection. */
export const STALE_CODES: ReadonlySet<string> = new Set([
  'accounting_lettering_line_lettered',
  'accounting_lettering_line_not_posted',
  'accounting_lettering_not_a_proposal',
  'accounting_lettering_cancelled',
]);

/** A fresh idempotency key for one lettering request (kept while the same request is retried). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
