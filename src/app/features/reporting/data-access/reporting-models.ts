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
}

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
