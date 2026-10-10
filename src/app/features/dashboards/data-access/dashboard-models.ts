/**
 * Contracts of the dashboards API (`backend/docs/api/openapi.yaml`, `Dashboards…` schemas).
 * Amounts are the API's decimal strings (6 places), counts are integers: nothing is computed
 * here.
 */

export interface CodeReference {
  readonly public_id: string;
  readonly code: string;
}

/** `DashboardsCompany`. */
export interface DashboardCompany {
  readonly public_id: string;
  readonly legal_name: string;
  readonly reference_currency: string;
}

/** `DashboardsEntryCounts`: each equals the entry list's count for the journal and status. */
export interface JournalEntryCounts {
  readonly total: number;
  readonly draft: number;
  readonly submitted: number;
  readonly validated: number;
  readonly locked: number;
}

/** `DashboardsJournalTreasury`: a treasury account whose default journal is the journal. */
export interface JournalTreasuryAccount {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly account_type: 'bank' | 'cash' | 'other';
  readonly status: 'active' | 'inactive';
  readonly currency: string;
  /** Treasury's balance at the request's `on`. */
  readonly balance: string;
  readonly unreconciled_statement_lines: number;
}

/** `DashboardsJournalSummary`. */
export interface JournalSummary {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly journal_type: 'sales' | 'purchase' | 'bank' | 'cash' | 'general';
  readonly default_currency: string | null;
  readonly entries: JournalEntryCounts;
  /** `null`: the treasury is not readable (`restricted` has `cash`); `[]`: none linked. */
  readonly treasury_accounts: readonly JournalTreasuryAccount[] | null;
}

/** `DashboardsJournalsResponse` (`GET dashboards/journals/`). */
export interface JournalsDashboard {
  readonly company: DashboardCompany;
  readonly fiscal_year: CodeReference | null;
  readonly on: string | null;
  readonly restricted: readonly 'cash'[];
  readonly journals: readonly JournalSummary[];
}

/** `ReportingScope`. */
export interface DashboardScope {
  readonly fiscal_year: CodeReference;
  readonly period: CodeReference | null;
  readonly date_from: string;
  readonly date_to: string;
}

/** `DashboardsAlert`: a closing check raised in a closing in progress. */
export interface DashboardAlert {
  readonly source: string;
  readonly code: string;
  readonly level: string;
  /** The server's text (not stable, not translated): never shown, the `code` is. */
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** `DashboardsIndicator`: a fact of a domain, counted, without any level decided yet. */
export interface DashboardIndicator {
  readonly source: string;
  readonly code: string;
  readonly count: number;
  readonly level: string | null;
}

/** `DashboardsAlertsResponse` (`GET dashboards/alerts/`). */
export interface DashboardAlerts {
  readonly company: DashboardCompany;
  readonly scope: DashboardScope;
  readonly alerts: readonly DashboardAlert[];
  readonly indicators: readonly DashboardIndicator[];
  /** The sources the reader may read: the others are not consulted. */
  readonly sources: readonly string[];
}
