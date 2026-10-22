import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import { DocumentStatus } from './data-access/documents-api';

/** « 12 Ko », « 1,4 Mo » (display only). */
export function fileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} o`;
  }
  const kilo = bytes / 1024;
  return kilo < 1024
    ? `${Math.round(kilo)} Ko`
    : `${(kilo / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/** What a document is attached to: the types the backend registers (`attachments.py`). */
export interface DocumentResource {
  readonly label: string;
  readonly plural: string;
  /** The record's screen, when the application has one. */
  readonly url?: (id: string) => string;
}

export const DOCUMENT_RESOURCES: Readonly<Record<string, DocumentResource>> = {
  'accounting.entry': {
    label: 'Écriture',
    plural: 'Écritures',
    url: (id) => `/app/comptabilite/ecritures/${id}`,
  },
  'treasury.operation': {
    label: 'Opération de trésorerie',
    plural: 'Opérations de trésorerie',
    url: (id) => `/app/comptabilite/tresorerie/operations/${id}`,
  },
  'assets.asset': { label: 'Immobilisation', plural: 'Immobilisations' },
  'loans.loan': { label: 'Emprunt', plural: 'Emprunts' },
};

export const DOCUMENT_STATUS: Readonly<
  Record<DocumentStatus, { label: string; plural: string; tone: BadgeTone; icon: IconName }>
> = {
  active: { label: 'Active', plural: 'Actives', tone: 'success', icon: 'check' },
  replaced: { label: 'Remplacée', plural: 'Remplacées', tone: 'neutral', icon: 'refresh' },
  deleted: { label: 'Supprimée', plural: 'Supprimées', tone: 'danger', icon: 'trash' },
  pending: { label: 'En cours d’envoi', plural: 'En cours', tone: 'warning', icon: 'clock' },
  failed: { label: 'Échec', plural: 'Échecs', tone: 'danger', icon: 'alert-triangle' },
};

/** « PDF », « Image », « Tableur »: what the file is, from its type. */
export function fileKind(contentType: string): { label: string; icon: IconName } {
  if (contentType === 'application/pdf') {
    return { label: 'PDF', icon: 'file' };
  }
  if (contentType.startsWith('image/')) {
    return { label: 'Image', icon: 'file' };
  }
  if (/spreadsheet|excel|csv/.test(contentType)) {
    return { label: 'Tableur', icon: 'file-spreadsheet' };
  }
  return { label: 'Fichier', icon: 'attachment' };
}

export const DOCUMENT_ERRORS: ErrorCatalog = {
  storage_unavailable: {
    title: 'Le stockage des pièces ne répond pas.',
    message: 'Réessayez dans un instant.',
  },
};
