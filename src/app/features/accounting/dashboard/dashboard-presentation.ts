import { JournalSummary } from '../../dashboards/data-access/dashboard-models';

/** The cards' order, as Odoo's: bank and cash, sales, purchases, miscellaneous operations. */
export const CARD_ORDER: Readonly<Record<JournalSummary['journal_type'], number>> = {
  cash: 0,
  bank: 1,
  sales: 2,
  purchase: 3,
  general: 4,
};

/** The invoices of a sales or purchase journal (paths of Comptabilité). */
export const DOCUMENT_PATHS: Readonly<Record<'sales' | 'purchase', string>> = {
  sales: 'ventes/factures',
  purchase: 'achats/factures',
};
