import { ErrorCatalog } from '../../../core/errors/user-error';
import { BadgeStatus } from '../../../shared/ui/badge/badge';
import { EntryStatus } from './prototype-models';

/** API state of an entry → generic badge of the design system (feminine labels). */
export const ENTRY_STATUS: Readonly<Record<EntryStatus, { badge: BadgeStatus; label: string }>> = {
  draft: { badge: 'draft', label: 'Brouillon' },
  submitted: { badge: 'pending', label: 'Soumise' },
  validated: { badge: 'validated', label: 'Validée' },
  locked: { badge: 'closed', label: 'Verrouillée' },
};

export const ENTRY_WORKFLOW: readonly { id: EntryStatus; label: string }[] = [
  { id: 'draft', label: 'Brouillon' },
  { id: 'submitted', label: 'Soumise' },
  { id: 'validated', label: 'Validée' },
  { id: 'locked', label: 'Verrouillée' },
];

/** Human messages for the accounting error codes of the API (`apps/accounting`). */
export const ACCOUNTING_ERRORS: ErrorCatalog = {
  accounting_entry_unbalanced: {
    title: 'Impossible de valider cette écriture.',
    message: 'Le total Débit ne correspond pas au total Crédit.',
    help:
      'Une écriture est validée seulement si la somme des débits est égale à la somme des ' +
      'crédits. Ouvrez l’onglet « Lignes comptables » : l’écart est affiché sous les totaux. ' +
      'Corrigez un montant ou ajoutez la ligne manquante, enregistrez, puis validez à nouveau.',
  },
  accounting_entry_lines_required: {
    title: 'Impossible de valider cette écriture.',
    message: 'Elle ne contient aucune ligne comptable.',
  },
  accounting_line_one_side: {
    title: 'Une ligne contient à la fois un débit et un crédit.',
    message: 'Chaque ligne porte un montant au débit ou au crédit, pas les deux.',
  },
  accounting_period_closed: {
    title: 'La période de cette date est clôturée.',
    message: 'Choisissez une date dans une période ouverte.',
  },
  accounting_entry_not_editable: {
    title: 'Cette écriture ne peut plus être modifiée.',
    message:
      'Seul un brouillon est modifiable. Une écriture validée se corrige par contrepassation.',
  },
  accounting_invalid_transition: {
    title: 'Cette action n’est plus possible sur cette écriture.',
    message: 'Son état a changé entre-temps. Rechargez la page pour voir son état actuel.',
  },
  accounting_entry_not_reversible: {
    title: 'Cette écriture ne peut pas être contrepassée.',
    message: 'Elle a peut-être déjà été contrepassée.',
  },
};
