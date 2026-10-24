import { PERIOD_PARAM } from '../report-period/report-period';

/** What the ledger lists: the accounts (« Grand livre général ») or the partners. */
export type LedgerMode = 'account' | 'partner';

/** The ledgers' screens, from the accounting application. */
export const LEDGER_PATHS: Readonly<Record<LedgerMode, string>> = {
  account: 'analyse/grand-livre',
  partner: 'analyse/grand-livre-auxiliaire',
};

/** URL of the ledgers, as Odoo's filters: readable and shareable. */
export const GENERAL_LEDGER_PARAM = {
  ...PERIOD_PARAM,
  /** One account, unfolded (from the balance or the account's record). */
  account: 'compte',
  /** One partner, unfolded (from the partner's record). */
  partner: 'tiers',
  /** The partner ledger's tiers accounts: `recevoir`, `payer`; none: both. */
  tiers: 'comptes',
  journal: 'journal',
  unposted: 'brouillons',
  search: 'q',
  page: 'page',
} as const;
