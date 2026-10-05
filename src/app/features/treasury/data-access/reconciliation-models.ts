/**
 * Bank reconciliation of the API (V2.1, lots A6, A6.1, A6.2), as the OpenAPI schemas give it
 * (`backend/docs/api/openapi.yaml`): treasury accounts, statements, statement lines, the
 * server's proposals, confirmed reconciliations. Only the fields this front end reads.
 */

export interface CodeReference {
  readonly public_id: string;
  readonly code: string;
}

export type Direction = 'inflow' | 'outflow';

/** `TreasuryTreasuryAccount` (the fields read here). */
export interface TreasuryAccount {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly account_type: 'bank' | 'cash' | 'other';
  readonly currency: string;
  readonly status: 'active' | 'inactive';
}

export type StatementLineStatus = 'unreconciled' | 'reconciled' | 'excluded';

/** `TreasuryStatementLine`. No partner, no account: the line is the bank's own record. */
export interface StatementLine {
  readonly public_id: string;
  readonly sequence: number;
  readonly line_date: string;
  readonly value_date: string | null;
  readonly direction: Direction;
  readonly amount: string;
  readonly description: string;
  readonly bank_reference: string;
  readonly external_id: string;
  readonly running_balance: string | null;
  readonly status: StatementLineStatus;
  readonly exclusion_reason: string;
}

/** `TreasuryStatement` (its lines are listed by `statement-lines/`, not read from here). */
export interface Statement {
  readonly public_id: string;
  readonly treasury_account: CodeReference;
  readonly reference: string;
  readonly statement_date: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly status: 'open' | 'closed';
}

/** `TreasuryOperation` (the fields read here). */
export interface TreasuryOperation {
  readonly public_id: string;
  readonly treasury_account: CodeReference;
  readonly operation_type: string;
  readonly direction: Direction;
  readonly status: 'draft' | 'confirmed' | 'accounted' | 'cancelled';
  readonly operation_date: string;
  readonly amount: string;
  readonly currency: string;
  readonly reference: string;
  readonly description: string;
  readonly counterparty: CodeReference | null;
  readonly counterparty_name: string;
  readonly accounting_entry: string | null;
}

/** The facts a proposal rests on (`Criterion` of the backend): never a score. */
export type ProposalCriterion =
  'same_account' | 'same_direction' | 'exact_amount' | 'only_candidate' | 'same_reference';

/** `Treasury_SettlementLine`: an accounting line named by its entry number and codes. */
export interface SettlementLine {
  readonly public_id: string;
  readonly entry: string;
  readonly entry_date: string;
  readonly account: string;
  readonly partner: string;
}

/** `TreasuryProposal`: a provisional match, never a reconciliation until confirmed. */
export interface ReconciliationProposal {
  readonly line: {
    readonly public_id: string;
    readonly statement: string;
    readonly line_date: string;
    readonly direction: Direction;
    readonly amount: string;
    readonly description: string;
    readonly bank_reference: string;
  };
  readonly operation: {
    readonly public_id: string;
    readonly operation_date: string;
    readonly direction: Direction;
    readonly amount: string;
    readonly reference: string;
    readonly description: string;
    readonly counterparty: string | null;
  };
  readonly amount: string;
  readonly matched_amount: string;
  readonly difference: string;
  readonly criteria: readonly ProposalCriterion[];
  readonly days_apart: number;
  readonly settlement: {
    readonly payment_line: SettlementLine;
    readonly invoice_line: SettlementLine;
    readonly amount: string;
  } | null;
}

/** `TreasuryProposalChoiceRequest`. */
export interface ProposalChoice {
  readonly line: string;
  readonly operation: string;
  readonly invoice_line?: string;
}

/** `TreasuryReconciliationLettering`: the lettering a confirmation created (A6.1). */
export interface ReconciliationLettering {
  readonly public_id: string;
  readonly reference: string;
  readonly status: string;
}

/** `TreasuryReconciliation`. */
export interface Reconciliation {
  readonly public_id: string;
  readonly statement_line: string;
  readonly status: 'active' | 'cancelled';
  readonly operations: readonly string[];
  readonly lettering: ReconciliationLettering | null;
  readonly reason: string;
  readonly cancelled_at: string | null;
  readonly created_at: string;
}

/** `TreasuryConfirmed`: one confirmed proposal. */
export interface ConfirmedProposal {
  readonly reconciliation: Reconciliation;
  readonly lettering: { readonly public_id: string; readonly reference: string } | null;
}
