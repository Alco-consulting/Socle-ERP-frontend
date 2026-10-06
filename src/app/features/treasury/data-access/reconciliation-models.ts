/**
 * Treasury of the API (Module 6; V2.1 lots A6, A6.1, A6.2), as the OpenAPI schemas give it
 * (`backend/docs/api/openapi.yaml`): treasury accounts, operations, transfers, statements,
 * statement lines, the server's proposals, reconciliations. One set of types for the whole
 * domain (the reconciliation screens and the others read the same ones).
 */

export interface CodeReference {
  readonly public_id: string;
  readonly code: string;
}

export type Direction = 'inflow' | 'outflow';
export type TreasuryAccountType = 'bank' | 'cash' | 'other';
export type RecordStatus = 'active' | 'inactive';
export type OperationType = 'deposit' | 'withdrawal' | 'transfer' | 'bank_fee' | 'other';
export type OperationStatus = 'draft' | 'confirmed' | 'accounted' | 'cancelled';
export type RoundingMode =
  'half_up' | 'half_even' | 'half_down' | 'up' | 'down' | 'ceiling' | 'floor';

/**
 * `TreasuryTreasuryAccount`. Bank identifiers come masked from the server unless the user
 * manages treasury accounts (`treasury.manage_accounts`): shown as given.
 */
export interface TreasuryAccount {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly account_type: TreasuryAccountType;
  readonly currency: string;
  readonly ledger_account?: CodeReference | null;
  readonly journal?: CodeReference | null;
  readonly bank_name?: string;
  readonly bank_branch?: string;
  readonly account_number?: string;
  readonly iban?: string;
  readonly bic?: string;
  readonly opening_balance?: string;
  readonly status: RecordStatus;
  readonly created_at?: string;
  readonly updated_at?: string;
}

/** `TreasuryTreasuryAccountWriteRequest` (the code is fixed by the server once used). */
export interface TreasuryAccountWrite {
  readonly code: string;
  readonly name: string;
  readonly account_type: TreasuryAccountType;
  readonly currency: string;
  readonly ledger_account?: string | null;
  readonly journal?: string | null;
  readonly opening_balance?: string;
  readonly bank_name?: string;
  readonly bank_branch?: string;
  readonly account_number?: string;
  readonly iban?: string;
  readonly bic?: string;
}

/** `TreasuryBalance`: the server's balance of an account at a date. */
export interface TreasuryBalance {
  readonly account: CodeReference;
  readonly on: string | null;
  readonly currency: string;
  readonly opening_balance: string;
  readonly inflows: string;
  readonly outflows: string;
  readonly balance: string;
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
  readonly opening_balance?: string;
  readonly closing_balance?: string;
  readonly status: 'open' | 'closed';
  readonly created_at?: string;
}

/**
 * `TreasuryReconciliationState`: the statement's own arithmetic and the balances at its
 * end, computed by the server (A6) — never recomputed here.
 */
export interface StatementState {
  readonly statement: string;
  readonly statement_balance: string;
  readonly lines_total: string;
  readonly treasury_balance: string;
  readonly accounting_balance: string | null;
  readonly accounting_currency: string;
  readonly statement_vs_treasury: string;
  readonly statement_vs_accounting: string | null;
  readonly opening_balance: string;
  readonly computed_closing_balance: string;
  readonly closing_difference: string;
  readonly balanced: boolean;
  readonly reconciled_total: string;
  readonly unreconciled_total: string;
  readonly excluded_total: string;
  readonly reconciled_count: number;
  readonly unreconciled_count: number;
  readonly excluded_count: number;
}

/** `TreasuryOperation`. */
export interface TreasuryOperation {
  readonly public_id: string;
  readonly treasury_account: CodeReference;
  readonly operation_type: OperationType | string;
  readonly direction: Direction;
  readonly status: OperationStatus;
  readonly operation_date: string;
  readonly value_date?: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly reference: string;
  readonly description: string;
  readonly counterparty: CodeReference | null;
  readonly counterparty_name: string;
  readonly offset_account?: CodeReference | null;
  readonly transfer?: string | null;
  readonly related_operation?: string | null;
  readonly reason?: string;
  readonly source_type?: string;
  readonly source_id?: string;
  readonly accounting_entry: string | null;
  readonly reconciled?: boolean | null;
  readonly confirmed_at?: string | null;
  readonly accounted_at?: string | null;
  readonly cancelled_at?: string | null;
  readonly created_at?: string;
}

/** `TreasuryOperationWriteRequest` (a draft; its commands move it on). */
export interface OperationWrite {
  readonly treasury_account: string;
  readonly operation_type: OperationType;
  readonly direction: Direction;
  readonly operation_date: string;
  readonly value_date?: string | null;
  readonly amount: string;
  readonly reference?: string;
  readonly description?: string;
  readonly counterparty?: string | null;
  readonly counterparty_name?: string;
  readonly offset_account?: string | null;
  readonly idempotency_key?: string;
}

/** `TreasuryTransfer`: two legs (operations) moving together. */
export interface Transfer {
  readonly public_id: string;
  readonly source_account: CodeReference;
  readonly destination_account: CodeReference;
  readonly transfer_date: string;
  readonly amount: string;
  readonly destination_amount: string;
  readonly exchange_rate: string;
  readonly rounding: string;
  readonly reference: string;
  readonly description: string;
  readonly operations: readonly TreasuryOperation[];
  readonly created_at: string;
}

/** `TreasuryTransferWriteRequest`. */
export interface TransferWrite {
  readonly source_account: string;
  readonly destination_account: string;
  readonly transfer_date: string;
  readonly amount: string;
  readonly rounding?: RoundingMode;
  readonly reference?: string;
  readonly description?: string;
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
