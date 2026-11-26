import { ErrorCatalog } from '../../core/errors/user-error';
import { APP_ROOT } from '../../core/navigation/applications';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import { InvoiceKind, InvoiceStatus, PaymentState } from './data-access/invoicing-models';

export const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/** A kind of document: its list, its words, its side (note backend 0038). */
export interface KindSpec {
  readonly kind: InvoiceKind;
  /** The list's path, relative to Comptabilité (its records are `<path>/:id`). */
  readonly path: string;
  readonly title: string;
  readonly word: string;
  readonly side: 'customer' | 'supplier';
  readonly partnerLabel: string;
  /** Created from its list (« Nouvelle facture »); a credit note comes from its invoice. */
  readonly creatable: boolean;
}

export const KINDS: Readonly<Record<InvoiceKind, KindSpec>> = {
  customer_invoice: {
    kind: 'customer_invoice',
    path: 'ventes/factures',
    title: 'Factures clients',
    word: 'Facture',
    side: 'customer',
    partnerLabel: 'Client',
    creatable: true,
  },
  customer_credit_note: {
    kind: 'customer_credit_note',
    path: 'ventes/avoirs',
    title: 'Avoirs clients',
    word: 'Avoir',
    side: 'customer',
    partnerLabel: 'Client',
    creatable: false,
  },
  supplier_invoice: {
    kind: 'supplier_invoice',
    path: 'achats/factures',
    title: 'Factures fournisseurs',
    word: 'Facture fournisseur',
    side: 'supplier',
    partnerLabel: 'Fournisseur',
    creatable: true,
  },
  supplier_credit_note: {
    kind: 'supplier_credit_note',
    path: 'achats/avoirs',
    title: 'Avoirs fournisseurs',
    word: 'Avoir fournisseur',
    side: 'supplier',
    partnerLabel: 'Fournisseur',
    creatable: false,
  },
};

/** The record of a document: under its kind's list. */
export function invoiceUrl(kind: InvoiceKind, invoiceId: string): string {
  return `${ACCOUNTING}/${KINDS[kind].path}/${invoiceId}`;
}

export const INVOICE_STATUS: Readonly<
  Record<InvoiceStatus, { label: string; tone: BadgeTone; icon: IconName }>
> = {
  draft: { label: 'Brouillon', tone: 'neutral', icon: 'edit' },
  posted: { label: 'Comptabilisée', tone: 'success', icon: 'check' },
  cancelled: { label: 'Annulée', tone: 'danger', icon: 'close' },
};

export const PAYMENT_STATE: Readonly<Record<PaymentState, { label: string; tone: BadgeTone }>> = {
  not_paid: { label: 'Non payée', tone: 'warning' },
  partial: { label: 'Partiellement payée', tone: 'info' },
  paid: { label: 'Payée', tone: 'success' },
};

export const INVOICING_ERRORS: ErrorCatalog = {
  invoicing_unit_category_mismatch: {
    title: 'Ces deux unités ne se convertissent pas l’une en l’autre.',
    message: 'Choisissez une unité convertible (ex. g, kg ou t pour un produit au kg).',
  },
  invoicing_unit_exists: {
    title: 'Une unité porte déjà ce nom.',
    message: 'Choisissez un autre nom.',
  },
  invoicing_unit_reference: {
    title: 'D’autres unités sont définies à partir de celle-ci.',
    message: 'Elle peut seulement être renommée.',
  },
  invoicing_product_account_missing: {
    title: 'Une ligne de la facture n’a pas de compte.',
    message:
      'Choisissez-le dans la colonne « Compte » de la ligne (ou sur le produit), puis comptabilisez à nouveau.',
  },
  invoicing_partner_account_missing: {
    title: 'Le compte du tiers n’est pas dans le plan comptable.',
    message: 'Vérifiez les comptes collectifs du tiers.',
  },
  invoicing_tax_account_missing: {
    title: 'Une taxe de la facture n’a pas de compte dans le plan.',
    message: 'Renseignez le compte de la taxe dans Configuration › Taxes.',
  },
  invoicing_product_account_nature: {
    title: 'Ce compte ne convient pas.',
    message:
      'Le compte de vente est un compte de produits (classe 7), le compte d’achat un compte de charges (classe 6).',
  },
  invoicing_product_code_exists: {
    title: 'Un produit porte déjà cette référence.',
    message: 'Choisissez une autre référence.',
  },
  invoicing_product_inactive: {
    title: 'Un produit de la facture est inactif.',
    message: 'Retirez-le, ou réactivez-le.',
  },
  invoicing_tax_side: {
    title: 'Une taxe ne s’applique pas à ce côté.',
    message: 'Choisissez une taxe de vente pour un client, d’achat pour un fournisseur.',
  },
  invoicing_tax_withholding_unsupported: {
    title: 'Une taxe retenue à la source ne se facture pas encore.',
    message: 'Choisissez une autre taxe.',
  },
  invoicing_unit_price_required: {
    title: 'Une ligne n’a pas de prix.',
    message: 'Saisissez le prix unitaire hors taxe.',
  },
  invoicing_journal_missing: {
    title: 'La société n’a pas de journal pour ce côté.',
    message: 'Créez un journal de ventes ou d’achats (Configuration › Journaux).',
  },
  invoicing_journal_kind: {
    title: 'Ce journal ne convient pas.',
    message: 'Une facture client va dans un journal de ventes, une facture fournisseur d’achats.',
  },
  invoicing_invoice_not_draft: {
    title: 'Ce document n’est plus un brouillon.',
    message: 'Il a été comptabilisé entre-temps : la fiche est rechargée.',
  },
  invoicing_invoice_empty: {
    title: 'Le document n’a pas de ligne, ou son total est nul.',
    message: 'Ajoutez une ligne avec un montant.',
  },
  invoicing_invoice_not_posted: {
    title: 'Seul un document comptabilisé se remet en brouillon ou reçoit un avoir.',
    message: 'La fiche est rechargée.',
  },
  invoicing_invoice_settled: {
    title: 'Ce document est réglé ou a un avoir, en tout ou en partie.',
    message:
      'Il ne se remet plus en brouillon et ne s’annule plus : défaites d’abord le règlement ou l’avoir.',
  },
  invoicing_invoice_numbered: {
    title: 'Ce brouillon a déjà son numéro.',
    message: 'Il ne se supprime pas, pour ne pas laisser de trou : annulez-le.',
  },
  invoicing_invoice_number_year: {
    title: 'Ce document est numéroté pour son année.',
    message: 'Choisissez une date de la même année.',
  },
  invoicing_credit_note_origin: {
    title: 'Un avoir se fait depuis une facture comptabilisée.',
    message: 'Ouvrez la facture, puis « Créer un avoir ».',
  },
  invoicing_credit_note_exceeds_invoice: {
    title: 'Les avoirs dépasseraient la facture.',
    message: 'Diminuez les quantités ou les prix de l’avoir.',
  },
  accounting_closing_required: {
    title: 'La période de la facture est clôturée.',
    message: 'Choisissez une date d’une période ouverte.',
  },
  accounting_period_closed: {
    title: 'La période de la facture est clôturée.',
    message: 'Choisissez une date d’une période ouverte.',
  },
  accounting_fiscal_year_closed: {
    title: 'L’exercice de la facture est clôturé.',
    message: 'Choisissez une date d’un exercice ouvert.',
  },
  partner_inactive: {
    title: 'Ce tiers est inactif.',
    message: 'Réactivez-le, ou choisissez un autre tiers.',
  },
  company_permission_denied: {
    title: 'Votre profil ne permet pas cette action.',
    message:
      'Comptabiliser demande aussi les droits de créer et de valider des écritures (et de lettrer pour un avoir).',
  },
};
