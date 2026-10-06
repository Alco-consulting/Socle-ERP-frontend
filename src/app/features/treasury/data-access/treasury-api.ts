import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  ConfirmedProposal,
  Direction,
  OperationStatus,
  OperationType,
  OperationWrite,
  ProposalChoice,
  Reconciliation,
  ReconciliationProposal,
  RecordStatus,
  RoundingMode,
  Statement,
  StatementLine,
  StatementLineStatus,
  StatementState,
  Transfer,
  TransferWrite,
  TreasuryAccount,
  TreasuryAccountType,
  TreasuryAccountWrite,
  TreasuryBalance,
  TreasuryOperation,
} from './reconciliation-models';

/** The fields of `TreasuryOperation` this front end shows (the rest is not read). */
export interface TreasuryOperationSummary {
  readonly public_id: string;
  readonly treasury_account: { readonly public_id: string; readonly code: string };
  readonly operation_type: string;
  readonly direction: 'inflow' | 'outflow';
  readonly status: 'draft' | 'confirmed' | 'accounted' | 'cancelled';
  readonly operation_date: string;
  readonly amount: string;
  readonly currency: string;
  readonly reference: string;
}

/** Filters of `GET treasury/accounts/` (the API's own). */
export interface AccountFilters {
  readonly accountType?: TreasuryAccountType | null;
  readonly status?: RecordStatus | null;
  readonly search?: string | null;
  readonly page?: number;
}

/** Filters of `GET treasury/operations/` (the API's own). */
export interface OperationFilters {
  readonly account?: string | null;
  readonly operationType?: OperationType | null;
  readonly direction?: Direction | null;
  readonly status?: OperationStatus | null;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly reference?: string | null;
  readonly reconciled?: boolean | null;
  readonly page?: number;
}

/** Page size of the treasury lists (accounts, operations, transfers, statements, lines). */
export const TREASURY_PAGE_SIZE = 25;
/** Page size of the reconciliation lists (lines, proposals). */
export const RECONCILIATION_PAGE_SIZE = TREASURY_PAGE_SIZE;
/** A company's treasury accounts and an account's statements fit in one page of choices. */
const CHOICES_PAGE_SIZE = 100;

const id = (value: string) => encodeURIComponent(value);
const page = (value: number | undefined) => (value && value > 1 ? value : null);
const flag = (value: boolean | null | undefined) =>
  value === null || value === undefined ? null : String(value);

/**
 * Treasury of the API (`treasury/`), company scoped by the interceptor. The server owns every
 * rule: balances, statuses and their transitions (commands, never a `PATCH` of a status),
 * postings, the statement's arithmetic, the proposals and their confirmation, and the
 * cancellation of a reconciliation — only the bank relation (A6.1). Nothing is computed here.
 */
@Injectable({ providedIn: 'root' })
export class TreasuryApi {
  private readonly api = inject(ApiClient);

  // ---- Accounts --------------------------------------------------------------------------

  /** The company's treasury accounts (bank, cash, other), for the choice of one. */
  accounts(): Observable<Paginated<TreasuryAccount>> {
    return this.api.get<Paginated<TreasuryAccount>>('treasury/accounts/', {
      params: { page_size: CHOICES_PAGE_SIZE },
    });
  }

  accountList(filters: AccountFilters = {}): Observable<Paginated<TreasuryAccount>> {
    return this.api.get<Paginated<TreasuryAccount>>('treasury/accounts/', {
      params: {
        account_type: filters.accountType ?? null,
        status: filters.status ?? null,
        search: filters.search ?? null,
        page: page(filters.page),
        page_size: TREASURY_PAGE_SIZE,
      },
    });
  }

  account(accountId: string): Observable<TreasuryAccount> {
    return this.api.get<TreasuryAccount>(`treasury/accounts/${id(accountId)}/`);
  }

  createAccount(write: TreasuryAccountWrite): Observable<TreasuryAccount> {
    return this.api.post<TreasuryAccount>('treasury/accounts/', write);
  }

  updateAccount(
    accountId: string,
    changes: Partial<TreasuryAccountWrite>,
  ): Observable<TreasuryAccount> {
    return this.api.patch<TreasuryAccount>(`treasury/accounts/${id(accountId)}/`, changes);
  }

  setAccountActive(accountId: string, active: boolean): Observable<TreasuryAccount> {
    const command = active ? 'reactivate' : 'deactivate';
    return this.api.post<TreasuryAccount>(`treasury/accounts/${id(accountId)}/${command}/`);
  }

  /** The server's balance of the account (today when `on` is not given). */
  balance(accountId: string, on: string | null = null): Observable<TreasuryBalance> {
    return this.api.get<TreasuryBalance>(`treasury/accounts/${id(accountId)}/balance/`, {
      params: { on },
    });
  }

  // ---- Operations ------------------------------------------------------------------------

  /** The operations accounted by an entry (`?accounting_entry=`): its treasury side. */
  operationsOfEntry(entryId: string): Observable<Paginated<TreasuryOperationSummary>> {
    return this.api.get<Paginated<TreasuryOperationSummary>>('treasury/operations/', {
      params: { accounting_entry: entryId, page_size: 10 },
    });
  }

  operations(filters: OperationFilters = {}): Observable<Paginated<TreasuryOperation>> {
    return this.api.get<Paginated<TreasuryOperation>>('treasury/operations/', {
      params: {
        account: filters.account ?? null,
        operation_type: filters.operationType ?? null,
        direction: filters.direction ?? null,
        status: filters.status ?? null,
        date_from: filters.dateFrom ?? null,
        date_to: filters.dateTo ?? null,
        reference: filters.reference ?? null,
        reconciled: flag(filters.reconciled),
        page: page(filters.page),
        page_size: TREASURY_PAGE_SIZE,
      },
    });
  }

  /** How many operations match (the `count` of a one-row page): smart buttons. */
  operationCount(filters: { account: string }): Observable<number> {
    return this.api
      .get<Paginated<TreasuryOperation>>('treasury/operations/', {
        params: { account: filters.account, page_size: 1 },
      })
      .pipe(map((result) => result.count));
  }

  operation(operationId: string): Observable<TreasuryOperation> {
    return this.api.get<TreasuryOperation>(`treasury/operations/${id(operationId)}/`);
  }

  createOperation(write: OperationWrite): Observable<TreasuryOperation> {
    return this.api.post<TreasuryOperation>('treasury/operations/', write);
  }

  /** A draft only (the server says `treasury_operation_not_editable` otherwise). */
  updateOperation(
    operationId: string,
    changes: Partial<OperationWrite>,
  ): Observable<TreasuryOperation> {
    return this.api.patch<TreasuryOperation>(`treasury/operations/${id(operationId)}/`, changes);
  }

  confirmOperation(operationId: string): Observable<TreasuryOperation> {
    return this.api.post<TreasuryOperation>(`treasury/operations/${id(operationId)}/confirm/`);
  }

  cancelOperation(operationId: string, reason: string): Observable<TreasuryOperation> {
    return this.api.post<TreasuryOperation>(`treasury/operations/${id(operationId)}/cancel/`, {
      reason,
    });
  }

  /** Posts the operation (a draft entry in Accounting); journal and rounding are optional. */
  accountOperation(
    operationId: string,
    posting: { journal?: string; rounding?: RoundingMode } = {},
  ): Observable<TreasuryOperation> {
    return this.api.post<TreasuryOperation>(
      `treasury/operations/${id(operationId)}/account/`,
      posting,
    );
  }

  /** Undoes the posting while its entry is still a draft (the server decides). */
  unpostOperation(operationId: string): Observable<TreasuryOperation> {
    return this.api.post<TreasuryOperation>(`treasury/operations/${id(operationId)}/unpost/`);
  }

  /** A correcting operation of an accounted one (201: the new operation). */
  correctOperation(
    operationId: string,
    correction: { reason: string; operation_date: string },
  ): Observable<TreasuryOperation> {
    return this.api.post<TreasuryOperation>(
      `treasury/operations/${id(operationId)}/correct/`,
      correction,
    );
  }

  // ---- Transfers -------------------------------------------------------------------------

  transfers(pageNumber = 1): Observable<Paginated<Transfer>> {
    return this.api.get<Paginated<Transfer>>('treasury/transfers/', {
      params: { page: page(pageNumber), page_size: TREASURY_PAGE_SIZE },
    });
  }

  transfer(transferId: string): Observable<Transfer> {
    return this.api.get<Transfer>(`treasury/transfers/${id(transferId)}/`);
  }

  createTransfer(write: TransferWrite): Observable<Transfer> {
    return this.api.post<Transfer>('treasury/transfers/', write);
  }

  confirmTransfer(transferId: string): Observable<Transfer> {
    return this.api.post<Transfer>(`treasury/transfers/${id(transferId)}/confirm/`);
  }

  cancelTransfer(transferId: string, reason: string): Observable<Transfer> {
    return this.api.post<Transfer>(`treasury/transfers/${id(transferId)}/cancel/`, { reason });
  }

  accountTransfer(
    transferId: string,
    posting: { journal?: string; rounding?: RoundingMode } = {},
  ): Observable<Transfer> {
    return this.api.post<Transfer>(`treasury/transfers/${id(transferId)}/account/`, posting);
  }

  // ---- Statements and their lines ----------------------------------------------------------

  /** The statements of an account, for the choice of one. */
  statements(account: string): Observable<Paginated<Statement>> {
    return this.api.get<Paginated<Statement>>('treasury/statements/', {
      params: { account, page_size: CHOICES_PAGE_SIZE },
    });
  }

  statementList(filters: {
    account?: string | null;
    status?: 'open' | 'closed' | null;
    page?: number;
  }): Observable<Paginated<Statement>> {
    return this.api.get<Paginated<Statement>>('treasury/statements/', {
      params: {
        account: filters.account ?? null,
        status: filters.status ?? null,
        page: page(filters.page),
        page_size: TREASURY_PAGE_SIZE,
      },
    });
  }

  /** How many statements an account has (the `count` of a one-row page): smart buttons. */
  statementCount(account: string): Observable<number> {
    return this.api
      .get<Paginated<Statement>>('treasury/statements/', { params: { account, page_size: 1 } })
      .pipe(map((result) => result.count));
  }

  statement(statementId: string): Observable<Statement> {
    return this.api.get<Statement>(`treasury/statements/${id(statementId)}/`);
  }

  /** The server's check of the statement: its arithmetic, balances, totals by state. */
  statementState(statementId: string): Observable<StatementState> {
    return this.api.get<StatementState>(`treasury/statements/${id(statementId)}/reconciliation/`);
  }

  /** Closes the statement (refused while opening + lines ≠ closing). */
  closeStatement(statementId: string): Observable<Statement> {
    return this.api.post<Statement>(`treasury/statements/${id(statementId)}/close/`);
  }

  /** The bank lines of an account or a statement, in one state (all when not given). */
  lines(filters: {
    account?: string | null;
    statement?: string | null;
    status?: StatementLineStatus | null;
    page?: number;
  }): Observable<Paginated<StatementLine>> {
    return this.api.get<Paginated<StatementLine>>('treasury/statement-lines/', {
      params: {
        account: filters.account ?? null,
        statement: filters.statement ?? null,
        status: filters.status ?? null,
        page: page(filters.page),
        page_size: RECONCILIATION_PAGE_SIZE,
      },
    });
  }

  /** How many lines of an account are in a state (the `count` of a one-row page). */
  lineCount(filters: { account: string; status: StatementLineStatus }): Observable<number> {
    return this.api
      .get<Paginated<StatementLine>>('treasury/statement-lines/', {
        params: { account: filters.account, status: filters.status, page_size: 1 },
      })
      .pipe(map((result) => result.count));
  }

  /** Sets a line aside from the reconciliation, with its reason. */
  excludeLine(lineId: string, reason: string): Observable<StatementLine> {
    return this.api.post<StatementLine>(`treasury/statement-lines/${id(lineId)}/exclude/`, {
      reason,
    });
  }

  /** Brings an excluded line back among the lines to reconcile. */
  includeLine(lineId: string): Observable<StatementLine> {
    return this.api.post<StatementLine>(`treasury/statement-lines/${id(lineId)}/include/`);
  }

  // ---- Reconciliation (V2.1 A6) -------------------------------------------------------------

  /** A line's reconciliations, its active one and those cancelled, newest first (A6.2). */
  reconciliationsOfLine(lineId: string): Observable<Paginated<Reconciliation>> {
    return this.api.get<Paginated<Reconciliation>>('treasury/reconciliations/', {
      params: { statement_line: lineId, page_size: RECONCILIATION_PAGE_SIZE },
    });
  }

  /** The server's proposals for an account, or one of its statements. */
  proposals(filters: {
    account: string;
    statement?: string | null;
    page?: number;
  }): Observable<Paginated<ReconciliationProposal>> {
    return this.api.get<Paginated<ReconciliationProposal>>('treasury/reconciliation-proposals/', {
      params: {
        // One scope: the statement when chosen (it belongs to the account), else the account.
        account: filters.statement ? null : filters.account,
        statement: filters.statement ?? null,
        page: page(filters.page),
        page_size: RECONCILIATION_PAGE_SIZE,
      },
    });
  }

  /** Confirms proposals, all or none; the server checks each again under its lock. */
  confirmProposals(items: readonly ProposalChoice[]): Observable<readonly ConfirmedProposal[]> {
    return this.api.post<readonly ConfirmedProposal[]>(
      'treasury/reconciliation-proposals/confirm/',
      { items },
    );
  }

  /** Cancels a reconciliation: the bank relation only (A6.1); kept, with the reason. */
  cancelReconciliation(reconciliationId: string, reason: string): Observable<Reconciliation> {
    return this.api.post<Reconciliation>(
      `treasury/reconciliations/${id(reconciliationId)}/cancel/`,
      { reason },
    );
  }
}
