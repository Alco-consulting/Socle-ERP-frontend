import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  ConfirmedProposal,
  ProposalChoice,
  Reconciliation,
  ReconciliationProposal,
  Statement,
  StatementLine,
  StatementLineStatus,
  TreasuryAccount,
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

/** Page size of the reconciliation lists (lines, proposals). */
export const RECONCILIATION_PAGE_SIZE = 25;
/** A company's treasury accounts and an account's statements fit in one page of choices. */
const CHOICES_PAGE_SIZE = 100;

const id = (value: string) => encodeURIComponent(value);
const page = (value: number | undefined) => (value && value > 1 ? value : null);

/**
 * Treasury of the API (`treasury/`), company scoped by the interceptor. Bank reconciliation
 * (V2.1 A6): the server lists the lines, computes the proposals, confirms them (and, when
 * asked, settles the invoice through Accounting's lettering) and cancels a reconciliation —
 * only the bank relation (A6.1). Never a status written here, never a match computed here.
 */
@Injectable({ providedIn: 'root' })
export class TreasuryApi {
  private readonly api = inject(ApiClient);

  /** The operations accounted by an entry (`?accounting_entry=`): its treasury side. */
  operationsOfEntry(entryId: string): Observable<Paginated<TreasuryOperationSummary>> {
    return this.api.get<Paginated<TreasuryOperationSummary>>('treasury/operations/', {
      params: { accounting_entry: entryId, page_size: 10 },
    });
  }

  /** The company's treasury accounts (bank, cash, other), for the choice of one. */
  accounts(): Observable<Paginated<TreasuryAccount>> {
    return this.api.get<Paginated<TreasuryAccount>>('treasury/accounts/', {
      params: { page_size: CHOICES_PAGE_SIZE },
    });
  }

  /** The statements of an account, for the choice of one. */
  statements(account: string): Observable<Paginated<Statement>> {
    return this.api.get<Paginated<Statement>>('treasury/statements/', {
      params: { account, page_size: CHOICES_PAGE_SIZE },
    });
  }

  /** The bank lines of an account (or of one of its statements), in one state. */
  lines(filters: {
    account: string;
    statement?: string | null;
    status: StatementLineStatus;
    page?: number;
  }): Observable<Paginated<StatementLine>> {
    return this.api.get<Paginated<StatementLine>>('treasury/statement-lines/', {
      params: {
        account: filters.account,
        statement: filters.statement ?? null,
        status: filters.status,
        page: page(filters.page),
        page_size: RECONCILIATION_PAGE_SIZE,
      },
    });
  }

  operation(operationId: string): Observable<TreasuryOperation> {
    return this.api.get<TreasuryOperation>(`treasury/operations/${id(operationId)}/`);
  }

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
