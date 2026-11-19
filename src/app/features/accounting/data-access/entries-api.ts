import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import { PartnerSummary } from '../../partners/data-access/partner-models';
import { Account } from './accounting-models';
import {
  AccountingSettings,
  Entry,
  EntryChanges,
  EntryCommand,
  EntryQuery,
  EntryWrite,
  ReverseRequest,
  TaxOption,
} from './entry-models';

/** Page size of the entry list (each entry comes with its lines). */
export const ENTRY_PAGE_SIZE = 25;
/** Answers of a search field (accounts, partners). */
const SUGGESTION_SIZE = 10;
const OPTIONS_PAGE_SIZE = 200;

const base = 'accounting/entries/';
const id = (value: string) => encodeURIComponent(value);

/**
 * Accounting entries of the API, company scoped (`X-Company-ID` by the interceptor, never
 * here). Filters and pages are the server's; every state change is one of its commands,
 * never a status written by the front end.
 */
@Injectable({ providedIn: 'root' })
export class EntriesApi {
  private readonly api = inject(ApiClient);

  list(query: EntryQuery = {}): Observable<Paginated<Entry>> {
    return this.api.get<Paginated<Entry>>(base, {
      params: {
        status: query.status ?? null,
        kind: query.kind ?? null,
        journal: query.journal ?? null,
        fiscal_year: query.fiscalYear ?? null,
        account: query.account ?? null,
        partner: query.partner ?? null,
        date_from: query.dateFrom ?? null,
        date_to: query.dateTo ?? null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: query.pageSize ?? ENTRY_PAGE_SIZE,
      },
    });
  }

  get(entryId: string): Observable<Entry> {
    return this.api.get<Entry>(`${base}${id(entryId)}/`);
  }

  create(entry: EntryWrite): Observable<Entry> {
    return this.api.post<Entry>(base, entry);
  }

  /** A draft's changed fields only (never its id, status, number, company or author). */
  update(entryId: string, changes: EntryChanges): Observable<Entry> {
    return this.api.patch<Entry>(`${base}${id(entryId)}/`, changes);
  }

  /** A draft only (the server refuses any other). */
  remove(entryId: string): Observable<void> {
    return this.api.delete<void>(`${base}${id(entryId)}/`);
  }

  /** `submit`, `reject`, `validate` or `lock`: the server decides whether it applies. */
  run(entryId: string, command: EntryCommand): Observable<Entry> {
    return this.api.post<Entry>(`${base}${id(entryId)}/${command}/`);
  }

  /** Creates the reversal (a new draft); the original is never modified. */
  reverse(entryId: string, request: ReverseRequest): Observable<Entry> {
    return this.api.post<Entry>(`${base}${id(entryId)}/reverse/`, request);
  }

  settings(): Observable<AccountingSettings> {
    return this.api.get<AccountingSettings>('accounting/settings/');
  }

  /** Only the settings given; each needs its own permission (the server checks). */
  saveSettings(changes: Partial<AccountingSettings>): Observable<AccountingSettings> {
    return this.api.put<AccountingSettings>('accounting/settings/', changes);
  }

  // ---- References for the form (searched by the server) --------------------------------

  /** Accounts an entry may use, as the server decides (`postable=true`, active). */
  postableAccounts(search: string): Observable<readonly Account[]> {
    return this.api
      .get<Paginated<Account>>('accounting/accounts/', {
        params: {
          search: search || null,
          postable: true,
          status: 'active',
          page_size: SUGGESTION_SIZE,
        },
      })
      .pipe(map((page) => page.results));
  }

  partners(search: string): Observable<readonly PartnerSummary[]> {
    return this.api
      .get<Paginated<PartnerSummary>>('partners/', {
        params: { search: search || null, status: 'active', page_size: SUGGESTION_SIZE },
      })
      .pipe(map((page) => page.results));
  }

  /** The partner of an exact code, or `null` (list filter). */
  partnerByCode(code: string): Observable<PartnerSummary | null> {
    return this.api
      .get<Paginated<PartnerSummary>>('partners/', { params: { code, page_size: 1 } })
      .pipe(map((page) => page.results[0] ?? null));
  }

  /** Active taxes of the company (`taxes.read`), for a line's tax. */
  taxes(): Observable<readonly TaxOption[]> {
    return this.api
      .get<Paginated<TaxOption>>('taxes/', {
        params: { status: 'active', page_size: OPTIONS_PAGE_SIZE },
      })
      .pipe(map((page) => page.results));
  }
}
