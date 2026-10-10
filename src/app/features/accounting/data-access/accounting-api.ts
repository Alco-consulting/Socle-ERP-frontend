import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  Account,
  AccountPrefix,
  AccountQuery,
  AccountType,
  AccountWrite,
  DetailedType,
  FiscalYear,
  Journal,
  JournalQuery,
  JournalType,
  JournalWrite,
  OpenClosed,
  Period,
  UsualJournals,
} from './accounting-models';

/** Page sizes: the chart of accounts is long, journals and periods are few. */
export const ACCOUNT_PAGE_SIZE = 50;
export const JOURNAL_PAGE_SIZE = 50;
/** A selection list reads every page: the server's largest (`API_MAX_PAGE_SIZE`). */
const OPTIONS_PAGE_SIZE = 200;

/** The accounts of a journal type (generic natures and types, no national code). */
const JOURNAL_ACCOUNT_FILTERS: Readonly<
  Partial<Record<JournalType, { accountType?: AccountType; detailedType?: DetailedType }>>
> = {
  sales: { accountType: 'income' },
  purchase: { accountType: 'expense' },
  bank: { detailedType: 'asset_cash' },
  cash: { detailedType: 'asset_cash' },
};
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

  /** The changes only; the code too, until an entry of the journal is numbered. */
  updateJournal(journalId: string, changes: Partial<JournalWrite>): Observable<Journal> {
    return this.api.patch<Journal>(`${base}journals/${id(journalId)}/`, changes);
  }

  setJournalActive(journalId: string, active: boolean): Observable<Journal> {
    const command = active ? 'reactivate' : 'deactivate';
    return this.api.post<Journal>(`${base}journals/${id(journalId)}/${command}/`);
  }

  /** « Créer les journaux usuels »: Ventes, Achats, Opérations diverses (by code). */
  createUsualJournals(): Observable<UsualJournals> {
    return this.api.post<UsualJournals>(`${base}default-journals/`);
  }

  /**
   * Every account a journal of `type` may take as default account, by code (a selection
   * list: all the pages, 200 at a time): active, postable, of the nature (revenue, expense)
   * or the type (bank and cash) it uses. None for miscellaneous operations.
   */
  journalAccounts(type: JournalType): Observable<readonly Account[]> {
    const filter = JOURNAL_ACCOUNT_FILTERS[type];
    if (!filter) {
      return of([]);
    }
    const pageOf = (page: number) =>
      this.api.get<Paginated<Account>>(`${base}accounts/`, {
        params: {
          status: 'active',
          postable: true,
          account_type: filter.accountType ?? null,
          detailed_type: filter.detailedType ?? null,
          page: page > 1 ? page : null,
          page_size: OPTIONS_PAGE_SIZE,
        },
      });
    return pageOf(1).pipe(
      switchMap((first) => {
        const pages = Math.ceil(first.count / OPTIONS_PAGE_SIZE);
        if (pages <= 1) {
          return of(first.results);
        }
        const rest = Array.from({ length: pages - 1 }, (_, index) => pageOf(index + 2));
        return forkJoin(rest).pipe(
          map((others) => [...first.results, ...others.flatMap((page) => page.results)]),
        );
      }),
    );
  }

  // ---- Chart of accounts ----------------------------------------------------------------

  accounts(query: AccountQuery = {}): Observable<Paginated<Account>> {
    return this.api.get<Paginated<Account>>(`${base}accounts/`, {
      params: {
        search: query.search || null,
        status: query.status ?? null,
        account_type: query.accountType ?? null,
        postable: query.postable ?? null,
        code_prefix: query.codePrefix || null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: ACCOUNT_PAGE_SIZE,
      },
    });
  }

  /** The active accounts whose code starts with `codePrefix`, by code: a selection list. */
  accountOptions(codePrefix: string): Observable<readonly Account[]> {
    return this.api
      .get<Paginated<Account>>(`${base}accounts/`, {
        params: { code_prefix: codePrefix, status: 'active', page_size: REFERENCE_PAGE_SIZE },
      })
      .pipe(map((page) => page.results));
  }

  /** How many accounts start with each first character and first two (never a hierarchy). */
  accountPrefixes(
    query: Pick<AccountQuery, 'search' | 'status' | 'accountType'> = {},
  ): Observable<readonly AccountPrefix[]> {
    return this.api.get<readonly AccountPrefix[]>(`${base}accounts/prefixes/`, {
      params: {
        search: query.search || null,
        status: query.status ?? null,
        account_type: query.accountType ?? null,
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
  accountCount(postable: boolean | null = null): Observable<number> {
    return this.api
      .get<Paginated<Account>>(`${base}accounts/`, { params: { postable, page_size: 1 } })
      .pipe(map((page) => page.count));
  }
}
