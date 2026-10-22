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

/** `DashboardsBalancePoint`: the balance on a day it changed. */
export interface BalancePoint {
  readonly date: string;
  readonly balance: string;
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
  /** Lines « à rapprocher », recorded without their counterpart yet (note backend 0050). */
  readonly lines_to_reconcile: number;
  /** With `on`: the last 30 days, its first and last points included; `null` without. */
  readonly history: readonly BalancePoint[] | null;
}

/** `DashboardsOpenDocuments`: a sales or purchase journal's documents (reference currency). */
export interface JournalDocuments {
  readonly drafts: number;
  /** `null`: a draft in a currency without rate. */
  readonly draft_amount: string | null;
  readonly unpaid: number;
  readonly unpaid_amount: string;
}

/** `DashboardsDueWeek`: no `date_from`, overdue before; no `date_to`, not due yet. */
export interface DueWeek {
  readonly date_from: string | null;
  readonly date_to: string | null;
  readonly amount: string;
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
  /** Sales and purchase journals with `invoicing.read`; `null` otherwise. */
  readonly invoices: JournalDocuments | null;
  /** Odoo's six bars, with `invoices` and `on`; `null` otherwise. */
  readonly due_weeks: readonly DueWeek[] | null;
}

/** `DashboardsJournalsResponse` (`GET dashboards/journals/`). */
export interface JournalsDashboard {
  readonly company: DashboardCompany;
  readonly fiscal_year: CodeReference | null;
  readonly on: string | null;
  readonly restricted: readonly 'cash'[];
  readonly journals: readonly JournalSummary[];
}

/** `DashboardsMetric`: an amount (decimal string) or a count; `null` when not known. */
export interface DashboardMetric {
  readonly code: string;
  readonly unit: 'amount' | 'count';
  readonly value: string | number | null;
  readonly currency: string | null;
}

/** `DashboardsOverviewResponse`: the headline metrics of each section the reader may read. */
export interface OverviewDashboard {
  readonly scope: {
    readonly fiscal_year: CodeReference;
    readonly date_from: string;
    readonly date_to: string;
  };
  readonly sections: readonly {
    readonly section: string;
    readonly metrics: readonly DashboardMetric[];
  }[];
  /** Sections named without figures: the reader may not read their source. */
  readonly restricted: readonly string[];
}

/** Reporting's scope: a fiscal year, or dates inside one. */
export type DashboardScope =
  { readonly fiscal_year: string } | { readonly date_from: string; readonly date_to: string };
