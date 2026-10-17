import { FieldMessageOverrides } from '../../core/errors/field-errors';
import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import { ContextualTransfer } from '../transfers/contextual-transfer';
import { PartnerRole, PartnerStatus, PartnerSummary } from './data-access/partner-models';

/** Words and look of each state (text + pictogram + color, never the color alone). */
export const PARTNER_STATUS: Readonly<
  Record<PartnerStatus, { label: string; tone: BadgeTone; icon: IconName }>
> = {
  active: { label: 'Actif', tone: 'success', icon: 'check' },
  inactive: { label: 'Inactif', tone: 'neutral', icon: 'lock' },
};

export const PARTNER_ROLES: readonly { id: PartnerRole; label: string }[] = [
  { id: 'customer', label: 'Clients' },
  { id: 'supplier', label: 'Fournisseurs' },
  { id: 'other', label: 'Ni client ni fournisseur' },
];

/** « Client », « Fournisseur », « Client et fournisseur », « Autre ». */
export function roleLabel(partner: Pick<PartnerSummary, 'is_customer' | 'is_supplier'>): string {
  if (partner.is_customer && partner.is_supplier) {
    return 'Client et fournisseur';
  }
  if (partner.is_customer) {
    return 'Client';
  }
  return partner.is_supplier ? 'Fournisseur' : 'Autre';
}

/** Errors of the partner commands, by their stable code (backend/docs/api/contract.md). */
export const PARTNER_ERRORS: ErrorCatalog = {
  partner_code_exists: {
    title: 'Ce code est déjà utilisé par un autre contact de la société.',
    message: 'Enregistrez à nouveau : le serveur attribue le numéro suivant.',
  },
  currency_inactive: {
    title: 'La devise choisie est inactive.',
    message: 'Choisissez une autre devise, ou aucune.',
  },
  payment_term_inactive: {
    title: 'La condition de paiement choisie est inactive.',
    message: 'Choisissez-en une autre, ou aucune.',
  },
  not_found: {
    title: 'Ce contact n’existe pas ou plus dans cette société.',
    message: 'Revenez à la liste des contacts.',
  },
};

/** Field errors the form words better than the generic ones. */
export const PARTNER_FIELD_MESSAGES: FieldMessageOverrides = {
  email: { invalid: 'Saisissez une adresse e-mail valide.' },
  country: { invalid: 'Saisissez le code pays à 2 lettres (ex. GN).' },
  default_currency: { unknown: 'Devise inconnue.' },
  customer_payment_term: { unknown: 'Condition de paiement inconnue.' },
  supplier_payment_term: { unknown: 'Condition de paiement inconnue.' },
};

/** Import and export of partners (API V1: `partners` for both). */
export const PARTNER_TRANSFER: ContextualTransfer = {
  importType: 'partners',
  exportType: 'partners',
  importPermission: 'partners.create',
  exportPermission: 'partners.read',
  importLabel: 'Importer des contacts',
  exportLabel: 'Exporter les contacts',
  importTitle: 'Import de contacts',
  importEffect:
    'Crée des fiches clients et fournisseurs à partir d’un fichier CSV ou Excel (.xlsx).',
  creationKey: 'partners',
  countLabel: (count) => `${count} contact${count > 1 ? 's' : ''}`,
  backLabel: 'Retour aux contacts',
  fieldLabels: {
    code: 'Code',
    name: 'Nom',
    country: 'Pays',
    legal_name: 'Raison sociale',
    is_customer: 'Client (oui/non)',
    is_supplier: 'Fournisseur (oui/non)',
    tax_identifier: 'Identifiant fiscal',
    registration_number: 'Numéro d’immatriculation',
    email: 'E-mail',
    phone: 'Téléphone',
    city: 'Ville',
    address: 'Adresse',
    default_currency: 'Devise par défaut',
  },
};
