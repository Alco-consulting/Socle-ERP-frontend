import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  Account,
  AccountQuery,
  AccountWrite,
  EntryStatus,
  FiscalYear,
  Journal,
  JournalQuery,
  JournalWrite,
  OpenClosed,
  Period,
} from './accounting-models';

/** Page sizes: the chart of accounts is long, journals and periods are few. */
export const ACCOUNT_PAGE_SIZE = 50;
export const JOURNAL_PAGE_SIZE = 50;
const REFERENCE_PAGE_SIZE = 100;

const base = 'accounting/';
const id = (value: string) => encodeURIComponent(value);

/**
 * The accounting referential of the API, company scoped (`X-Company-ID` by the
 * interceptor, never here). Search, filters and pages are the server's.
 */
@Injectable({ providedIn: 'root' })
export class AccountingApi {
  private readonly api = inject(ApiClient);

  // ---- Fiscal years and periods (read only in this module) ---------------------------

  fiscalYears(status: OpenClosed | null = null): Observable<Paginated<FiscalYear>> {
    return this.api.get<Paginated<FiscalYear>>(`${base}fiscal-years/`, {
      params: { status, page_size: REFERENCE_PAGE_SIZE },
    });
  }

  periods(fiscalYearId: string, status: OpenClosed | null = null): Observable<Paginated<Period>> {
    return this.api.get<Paginated<Period>>(`${base}periods/`, {
      params: { fiscal_year: fiscalYearId, status, page_size: REFERENCE_PAGE_SIZE },
    });
  }

  // ---- Journals -----------------------------------------------------------------------

  journals(query: JournalQuery = {}): Observable<Paginated<Journal>> {
    return this.api.get<Paginated<Journal>>(`${base}journals/`, {
      params: {
        code: query.code || null,
        status: query.status ?? null,
        journal_type: query.journalType ?? null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: JOURNAL_PAGE_SIZE,
      },
    });
  }

  journal(journalId: string): Observable<Journal> {
    return this.api.get<Journal>(`${base}journals/${id(journalId)}/`);
  }

  createJournal(journal: JournalWrite): Observable<Journal> {
    return this.api.post<Journal>(`${base}journals/`, journal);
  }

  updateJournal(
    journalId: string,
    changes: Partial<Omit<JournalWrite, 'code'>>,
  ): Observable<Journal> {
    return this.api.patch<Journal>(`${base}journals/${id(journalId)}/`, changes);
  }

  setJournalActive(journalId: string, active: boolean): Observable<Journal> {
    const command = active ? 'reactivate' : 'deactivate';
    return this.api.post<Journal>(`${base}journals/${id(journalId)}/${command}/`);
  }

  // ---- Chart of accounts ----------------------------------------------------------------

  accounts(query: AccountQuery = {}): Observable<Paginated<Account>> {
    return this.api.get<Paginated<Account>>(`${base}accounts/`, {
      params: {
        search: query.search || null,
        status: query.status ?? null,
        account_type: query.accountType ?? null,
        postable: query.postable ?? null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: ACCOUNT_PAGE_SIZE,
      },
    });
  }

  account(accountId: string): Observable<Account> {
    return this.api.get<Account>(`${base}accounts/${id(accountId)}/`);
  }

  /** The account of an exact code (the server normalizes it), or `null`. */
  accountByCode(code: string): Observable<Account | null> {
    return this.api
      .get<Paginated<Account>>(`${base}accounts/`, { params: { code, page_size: 1 } })
      .pipe(map((page) => page.results[0] ?? null));
  }

  /** Direct sub-accounts, as the server keeps the hierarchy. */
  children(accountId: string, page = 1): Observable<Paginated<Account>> {
    return this.api.get<Paginated<Account>>(`${base}accounts/${id(accountId)}/children/`, {
      params: { page: page > 1 ? page : null, page_size: ACCOUNT_PAGE_SIZE },
    });
  }

  createAccount(account: AccountWrite): Observable<Account> {
    return this.api.post<Account>(`${base}accounts/`, account);
  }

  updateAccount(
    accountId: string,
    changes: Partial<Omit<AccountWrite, 'code'>>,
  ): Observable<Account> {
    return this.api.patch<Account>(`${base}accounts/${id(accountId)}/`, changes);
  }

  setAccountActive(accountId: string, active: boolean): Observable<Account> {
    const command = active ? 'reactivate' : 'deactivate';
    return this.api.post<Account>(`${base}accounts/${id(accountId)}/${command}/`);
  }

  // ---- Counts for the dashboard (the server counts, `count` of a one-row page) ---------

  /** Entries of a status (all without one), optionally of one journal or fiscal year. */
  entryCount(
    status: EntryStatus | null,
    filter: { readonly journal?: string; readonly fiscalYear?: string } = {},
  ): Observable<number> {
    return this.api
      .get<Paginated<unknown>>(`${base}entries/`, {
        params: {
          status,
          journal: filter.journal ?? null,
          fiscal_year: filter.fiscalYear ?? null,
          page_size: 1,
        },
      })
      .pipe(map((page) => page.count));
  }

  accountCount(postable: boolean | null = null): Observable<number> {
    return this.api
      .get<Paginated<Account>>(`${base}accounts/`, { params: { postable, page_size: 1 } })
      .pipe(map((page) => page.count));
  }
}
