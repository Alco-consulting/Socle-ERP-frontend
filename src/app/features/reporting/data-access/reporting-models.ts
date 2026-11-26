/**
 * Contracts of Reporting's ledgers and trial balance (`backend/docs/api/openapi.yaml`):
 * amounts are exact decimal strings (6 places) in the company's reference currency; running
 * balances, totals, openings, columns and sub-totals are the server's.
 */

export interface CodeReference {
  readonly public_id: string;
  readonly code: string;
}

/** `ReportingScope`: the fiscal year (and period) the report covers. */
export interface ReportScope {
  readonly fiscal_year: CodeReference;
  readonly period: CodeReference | null;
  readonly date_from: string;
  readonly date_to: string;
}

/** `ReportingPartnerRef`. */
export interface PartnerReference {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
}

/** `ReportingLedgerRow`: one posted line, with the server's running balance. */
export interface LedgerRow {
  readonly line: string;
  /** Public id of the entry (the drill-down's next level). */
  readonly entry: string;
  readonly entry_date: string;
  readonly entry_number: string;
  /** Code of the journal. */
  readonly journal: string;
  readonly account: string;
  readonly account_code: string;
  readonly label: string;
  readonly document_reference: string;
  readonly partner: PartnerReference | null;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  /** Odoo's « Correspondance »: the reference of the line's lettering; blank if none. */
  readonly lettering?: string;
  /** Its first due date (an invoice's line). */
  readonly due_date?: string | null;
}

/** `ReportingStatementAccount`: an account of a line, its amount as its side shows it. */
export interface StatementAccount {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly amount: string;
}

/** `ReportingStatementLine`: a line of the compte de résultat, its code the accounts' prefix. */
export interface StatementLine {
  readonly code: string;
  readonly name: string;
  readonly amount: string;
  readonly accounts: readonly StatementAccount[];
}

/** `ReportingStatementBlock`: Charges d'exploitation, Produits financiers… */
export interface StatementBlock {
  readonly code: string;
  readonly name: string;
  readonly total: string;
  readonly lines: readonly StatementLine[];
}

export interface StatementSide {
  readonly blocks: readonly StatementBlock[];
  readonly total: string;
}

/**
 * `ReportingIncomeStatement` (`GET reporting/income-statement/`, note backend 0055): charges
 * and products, the result, a profit written with the charges or a loss with the products, and
 * both sides' total.
 */
export interface IncomeStatement {
  readonly scope: ReportScope;
  readonly charges: StatementSide;
  readonly products: StatementSide;
  readonly result: string;
  readonly profit: string;
  readonly loss: string;
  readonly total: string;
  readonly unclassified: readonly StatementAccount[];
  readonly warnings: readonly ReportWarning[];
}

/** `ReportingSheetBlock`: a block of the bilan; blocks of the same `row` face each other. */
export interface BalanceSheetBlock {
  readonly code: string;
  readonly name: string;
  readonly row: number;
  readonly total: string;
  readonly accounts: readonly StatementAccount[];
  /** The year's result, in the block that holds it; `null` elsewhere. */
  readonly result: string | null;
}

export interface BalanceSheetSide {
  readonly blocks: readonly BalanceSheetBlock[];
  readonly total: string;
}

/**
 * `ReportingBalanceSheet` (`GET reporting/balance-sheet/`, note backend 0056): the balances at
 * the end date, assets facing liabilities; the scope starts on the fiscal year's first day.
 */
export interface BalanceSheet {
  readonly scope: ReportScope;
  readonly assets: BalanceSheetSide;
  readonly liabilities: BalanceSheetSide;
  readonly result: string;
  readonly result_name: string;
  readonly unclassified: readonly StatementAccount[];
  readonly warnings: readonly ReportWarning[];
}

/** `ReportingWarning`: said by its code. */
export interface ReportWarning {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | null;
}

interface LedgerHeader {
  readonly scope: ReportScope;
  readonly opening_balance: string;
  /** Odoo's « Solde initial »: the debits and the credits before the scope. */
  readonly opening_debit: string;
  readonly opening_credit: string;
  readonly total_debit: string;
  readonly total_credit: string;
  readonly closing_balance: string;
  readonly warnings: readonly ReportWarning[];
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly LedgerRow[];
}

/** `ReportingAccountLedgerHeaderPage` (`GET reporting/ledger/<account>/`). */
export interface AccountLedger extends LedgerHeader {
  readonly account: CodeReference & { readonly name: string; readonly account_type: string };
}

/** `ReportingPartnerLedgerHeaderPage` (`GET reporting/partners/<partner>/ledger/`). */
export interface PartnerLedger extends LedgerHeader {
  readonly partner: PartnerReference;
}

/** What a ledger is read over: a fiscal year (the API never implies one), dates within it. */
export interface LedgerQuery {
  readonly fiscalYear: string;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly page?: number;
  readonly pageSize?: number;
  /** Account ledger only: the account's sub-accounts too. */
  readonly includeDescendants?: boolean;
  /** Public ids; none: every journal. */
  readonly journals?: readonly string[];
  readonly includeUnposted?: boolean;
  /** Partner ledger only: Odoo's « Comptes à recevoir », « Comptes à payer ». */
  readonly tiers?: readonly TiersAccount[];
}

/** Odoo's tiers accounts of the partner ledger. */
export type TiersAccount = 'receivable' | 'payable';

/** An account of the general ledger (note backend 0053). */
export interface GeneralLedgerFigures {
  /** Odoo's « Solde initial » line. */
  readonly opening_debit: string;
  readonly opening_credit: string;
  readonly opening: string;
  /** The period's. */
  readonly debit: string;
  readonly credit: string;
  /** Odoo's account line: before and within the period. */
  readonly total_debit: string;
  readonly total_credit: string;
  readonly closing: string;
}

/** `ReportingGeneralLedgerRow`. */
export interface GeneralLedgerRow extends GeneralLedgerFigures {
  readonly account: CodeReference & { readonly name: string; readonly account_type: string };
}

/** `ReportingGeneralLedgerHeaderPage` (`GET reporting/general-ledger/`). */
export interface GeneralLedger {
  readonly scope: ReportScope;
  /** « oct. 2026 », the heading of the columns. */
  readonly period: string;
  readonly totals: GeneralLedgerFigures;
  readonly warnings: readonly ReportWarning[];
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly GeneralLedgerRow[];
}

/** `ReportingPartnersLedgerRow`: a partner of the partner ledger (note backend 0054). */
export interface PartnersLedgerRow extends GeneralLedgerFigures {
  readonly partner: PartnerReference;
}

/** `GET reporting/partner-ledger/`: the same header as the general ledger's. */
export interface PartnersLedger extends Omit<GeneralLedger, 'results'> {
  readonly results: readonly PartnersLedgerRow[];
}

/** Odoo's filters of the partner ledger. */
export interface PartnersLedgerQuery extends Omit<GeneralLedgerQuery, 'account'> {
  /** One partner only (`?tiers=`). */
  readonly partner: string | null;
  readonly tiers: readonly TiersAccount[];
}

/** Odoo's filters of the general ledger. */
export interface GeneralLedgerQuery {
  readonly dateFrom: string;
  readonly dateTo: string;
  /** One account only (`?compte=`). */
  readonly account: string | null;
  readonly journals: readonly string[];
  readonly includeUnposted: boolean;
  readonly search: string;
  readonly page: number;
}

/** `ReportingMovement`: a period's debit and credit. */
export interface BalanceMovement {
  readonly debit: string;
  readonly credit: string;
}

/** `ReportingBalancePeriod`: the dates of a pair of columns, headed as Odoo's (« oct. 2026 »). */
export interface BalancePeriod {
  readonly date_from: string;
  readonly date_to: string;
  readonly label: string;
}

/** The figures of a row: the balance at the start, each period's movements, at the end. */
export interface BalanceFigures {
  readonly opening: string;
  readonly closing: string;
  /** One per period, oldest first. */
  readonly movements: readonly BalanceMovement[];
}

/** `ReportingBalanceGroup`: a class (level 1) or a two-digit group (level 2), summed. */
export interface BalanceGroup extends BalanceFigures {
  readonly code: string;
  /** The chart standard's name (« Clients et comptes rattachés »); blank without one. */
  readonly name: string;
  readonly level: number;
}

/** `ReportingBalanceRow`: one account of the balance. */
export interface BalanceRow extends BalanceFigures {
  readonly account: CodeReference & { readonly name: string; readonly account_type: string };
}

/** `ReportingBalanceHeaderPage` (`GET reporting/balance/`, notes backend 0051 and 0052). */
export interface TrialBalance {
  readonly scope: ReportScope;
  /** The periods' columns, oldest first; the last is the scope. */
  readonly periods: readonly BalancePeriod[];
  readonly totals: {
    readonly opening: string;
    readonly debit: string;
    readonly credit: string;
    readonly closing: string;
    /**
     * Les totaux des soldes débiteurs et créditeurs, à l'ouverture et à la clôture, sur toutes
     * les lignes (toutes les pages). Demandés au backend : absents, la ligne Total les laisse
     * vides plutôt que de les calculer sur la seule page affichée.
     */
    readonly opening_debit?: string;
    readonly opening_credit?: string;
    readonly closing_debit?: string;
    readonly closing_credit?: string;
  };
  /** Each period's movements over every row (every page). */
  readonly movements: readonly BalanceMovement[];
  /** The classes and groups of every row, by code. */
  readonly groups: readonly BalanceGroup[];
  readonly warnings: readonly ReportWarning[];
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly BalanceRow[];
}

/** Odoo's filters of the balance: its dates, the earlier periods, journals, drafts, search. */
export interface BalanceQuery {
  readonly dateFrom: string;
  readonly dateTo: string;
  /** Odoo's comparison: earlier periods, oldest first. */
  readonly earlier: readonly { readonly from: string; readonly to: string }[];
  /** Public ids; none: every journal. */
  readonly journals: readonly string[];
  readonly includeUnposted: boolean;
  readonly search: string;
  readonly page: number;
}

/** `ReportingBookLine`: a line of an entry of the livre-journal (note backend 0068). */
export interface JournalBookLine {
  readonly account_code: string;
  readonly account_name: string;
  readonly partner_code: string | null;
  readonly partner_name: string | null;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
}

/** `ReportingJournalBookRow`: a posted entry, in date then number order, with its lines. */
export interface JournalBookEntry {
  readonly public_id: string;
  readonly entry_number: string;
  readonly entry_date: string;
  readonly journal_code: string;
  readonly journal_name: string;
  readonly description: string;
  readonly document_reference: string;
  readonly lines: readonly JournalBookLine[];
  readonly debit: string;
  readonly credit: string;
}

/** `ReportingJournalTotals`: a journal of the scope and its totals. */
export interface JournalBookTotals {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly entries: number;
  readonly debit: string;
  readonly credit: string;
}

/** `GET reporting/journal-book/`: the totals are the scope's, whatever the page. */
export interface JournalBook {
  readonly scope: ReportScope;
  readonly period: string;
  readonly journals: readonly JournalBookTotals[];
  readonly debit: string;
  readonly credit: string;
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly JournalBookEntry[];
}
