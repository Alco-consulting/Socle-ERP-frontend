import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';

/** `state` of the list: posted (validated or locked, the default), draft, submitted, all. */
export type LineState = 'posted' | 'draft' | 'submitted' | 'all';

/** `AccountingEntryLineRow`: a line of « Écritures comptables » (note backend 0039). */
export interface EntryLineRow {
  readonly public_id: string;
  readonly entry: {
    readonly public_id: string;
    readonly entry_number: string;
    readonly status: string;
    readonly entry_date: string;
    readonly description: string;
    readonly document_reference: string;
  };
  readonly journal: { readonly public_id: string; readonly code: string };
  readonly sequence: number;
  readonly account: { readonly public_id: string; readonly code: string; readonly name: string };
  readonly partner: {
    readonly public_id: string;
    readonly code: string;
    readonly name: string;
  } | null;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
  readonly currency: string;
  readonly reference_debit: string;
  readonly reference_credit: string;
  readonly reference_currency: string;
  /** The reference of its active lettering (LET-000001), else null. */
  readonly lettering: string | null;
}

/** One class of the panel: the code's first character and its lines. */
export interface LineClass {
  readonly prefix: string;
  readonly count: number;
}

export interface EntryLineQuery {
  readonly state?: LineState;
  readonly journal?: string | null;
  readonly accountPrefix?: string | null;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly search?: string;
  readonly page?: number;
}

export const LINE_PAGE_SIZE = 50;
const base = 'accounting/entry-lines/';

/** The lines of the entries on the API (`accounting/entry-lines/`), company scoped. */
@Injectable({ providedIn: 'root' })
export class EntryLinesApi {
  private readonly api = inject(ApiClient);

  lines(query: EntryLineQuery = {}): Observable<Paginated<EntryLineRow>> {
    return this.api.get<Paginated<EntryLineRow>>(base, {
      params: {
        ...this.filters(query),
        account_prefix: query.accountPrefix || null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: LINE_PAGE_SIZE,
      },
    });
  }

  /** The panel « Tous, 1, 4, 5… »: the lines of the same filters by account class. */
  classes(query: EntryLineQuery = {}): Observable<readonly LineClass[]> {
    return this.api.get<readonly LineClass[]>(`${base}classes/`, { params: this.filters(query) });
  }

  private filters(query: EntryLineQuery) {
    return {
      state: query.state && query.state !== 'posted' ? query.state : null,
      journal: query.journal || null,
      date_from: query.dateFrom || null,
      date_to: query.dateTo || null,
      search: query.search || null,
    };
  }
}
