import { ErrorCatalog } from '../../../core/errors/user-error';
import { AgedDocumentKind, AgingBucket, AgingRole } from '../data-access/aging-models';

/**
 * Words of the aged balance (V2.1, lot A5). A bucket is named from the bounds the API gives
 * (layout only): the buckets, their bounds and every amount are the server's.
 */

export function bucketLabel(bucket: AgingBucket): string {
  if (bucket.first_day === null) {
    return 'Non échue';
  }
  if (bucket.last_day === null) {
    return bucket.first_day > 1 ? `Plus de ${bucket.first_day - 1} j` : 'Échue';
  }
  return `${bucket.first_day}–${bucket.last_day} j`;
}

/** The accessible name of a bucket (« de 31 à 60 jours de retard »). */
export function bucketDescription(bucket: AgingBucket): string {
  if (bucket.first_day === null) {
    return 'non échue';
  }
  if (bucket.last_day === null) {
    return `${bucket.first_day} jours de retard et plus`;
  }
  return `de ${bucket.first_day} à ${bucket.last_day} jours de retard`;
}

export const ROLE_TITLES: Readonly<Record<AgingRole, string>> = {
  customer: 'Balance âgée clients',
  supplier: 'Balance âgée fournisseurs',
};

export const DOCUMENT_KINDS: Readonly<Record<AgedDocumentKind, string>> = {
  installment: 'Échéance',
  unscheduled: 'Facture sans échéancier',
  unapplied: 'Règlement ou avoir non affecté',
};

/** Errors of the aged balance and its buckets, by their stable code. */
export const AGING_ERRORS: ErrorCatalog = {
  reporting_aging_bucket_unknown: {
    title: 'Cette tranche n’existe plus.',
    message: 'Les tranches de la société ont changé : choisissez une des tranches proposées.',
  },
  not_found: {
    title: 'Ce tiers n’existe pas dans cette société.',
    message: 'Revenez à la balance âgée.',
  },
};
