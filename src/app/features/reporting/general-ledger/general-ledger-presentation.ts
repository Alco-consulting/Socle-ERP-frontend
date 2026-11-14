import { GeneralLedgerFigures, LedgerRow } from '../data-access/reporting-models';
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

/** La vue du grand livre : le tableau (comme Odoo) ou les comptes en T, une carte par compte. */
export type LedgerView = 'table' | 'cards';

/** Les deux vues, dans la barre du rapport. */
export const LEDGER_VIEWS: readonly { readonly id: LedgerView; readonly label: string }[] = [
  { id: 'table', label: 'Vue tableau' },
  { id: 'cards', label: 'Comptes en T' },
];

/** Les mouvements montrés sur une carte ; les autres se voient dans la vue tableau. */
export const CARD_LINES = 6;

const LEDGER_VIEW_KEY = 'alco.ledgerView';

/** La vue retenue sur cet appareil ; le tableau sans choix ou sans stockage. */
export function readLedgerView(): LedgerView {
  try {
    return localStorage.getItem(LEDGER_VIEW_KEY) === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

/** Retient la vue sur cet appareil ; un stockage bloqué la garde jusqu'à la fermeture. */
export function rememberLedgerView(view: LedgerView): void {
  try {
    localStorage.setItem(LEDGER_VIEW_KEY, view);
  } catch {
    // Fenêtre privée ou stockage bloqué : la vue vaut pour cette page seulement.
  }
}

/** A line of the report: an account or a partner, its figures. */
export interface Subject {
  readonly id: string;
  readonly code: string;
  /** As Odoo shows it: « 571001 Caisse Principale », a partner by its name. */
  readonly label: string;
  readonly figures: GeneralLedgerFigures;
}

/** The lines of an unfolded subject, read page by page (« Charger plus »). */
export interface SubjectLines {
  readonly rows: readonly LedgerRow[];
  readonly count: number;
  readonly page: number;
  readonly loading: boolean;
  readonly failed: boolean;
}
