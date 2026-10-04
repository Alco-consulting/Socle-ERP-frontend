/**
 * Contracts of Reporting's ledgers (`backend/docs/api/openapi.yaml`): amounts are exact
 * decimal strings (6 places) in the company's reference currency; running balances, totals
 * and openings are the server's.
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
}

interface LedgerHeader {
  readonly scope: ReportScope;
  readonly opening_balance: string;
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

/** What a ledger is read over: a fiscal year (the API never implies one). */
export interface LedgerQuery {
  readonly fiscalYear: string;
  readonly page?: number;
  /** Account ledger only: the account's sub-accounts too. */
  readonly includeDescendants?: boolean;
}
