import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  CurrencyOption,
  Partner,
  PartnerQuery,
  PartnerSummary,
  PartnerTag,
  PartnerUpdate,
  PartnerWrite,
} from './partner-models';

/** Page size of the partner list (the server caps it at API_MAX_PAGE_SIZE). */
export const PARTNER_PAGE_SIZE = 20;

/** Options of a form select: one page is plenty (payment terms, currencies). */
const OPTIONS_PAGE_SIZE = 200;

/**
 * Tiers of the API, company scoped: `X-Company-ID` is added by the interceptor, never here.
 * Search, filters and pages are the server's: nothing is filtered in the browser.
 */
@Injectable({ providedIn: 'root' })
export class PartnersApi {
  private readonly api = inject(ApiClient);

  list(query: PartnerQuery = {}): Observable<Paginated<PartnerSummary>> {
    return this.api.get<Paginated<PartnerSummary>>('partners/', {
      params: {
        search: query.search || null,
        role: query.role ?? null,
        status: query.status ?? null,
        tag: query.tag ?? null,
        country: query.country || null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: query.pageSize ?? PARTNER_PAGE_SIZE,
      },
    });
  }

  /** The partner of an exact code (the server normalizes it), or `null`. */
  byCode(code: string): Observable<PartnerSummary | null> {
    return this.api
      .get<Paginated<PartnerSummary>>('partners/', { params: { code, page_size: 1 } })
      .pipe(map((page) => page.results[0] ?? null));
  }

  get(id: string): Observable<Partner> {
    return this.api.get<Partner>(`partners/${encodeURIComponent(id)}/`);
  }

  create(partner: PartnerWrite): Observable<Partner> {
    return this.api.post<Partner>('partners/', partner);
  }

  /** Only the fields given are changed (the code never is). */
  update(id: string, changes: PartnerUpdate): Observable<Partner> {
    return this.api.patch<Partner>(`partners/${encodeURIComponent(id)}/`, changes);
  }

  deactivate(id: string): Observable<Partner> {
    return this.api.post<Partner>(`partners/${encodeURIComponent(id)}/deactivate/`);
  }

  reactivate(id: string): Observable<Partner> {
    return this.api.post<Partner>(`partners/${encodeURIComponent(id)}/reactivate/`);
  }

  /** The company's tags, searched by name (note backend 0045). */
  tags(search = ''): Observable<readonly PartnerTag[]> {
    return this.api
      .get<Paginated<PartnerTag>>('partners/tags/', {
        params: { search: search || null, page_size: OPTIONS_PAGE_SIZE },
      })
      .pipe(map((page) => page.results));
  }

  /** A tag of this name, created when the company has none: Odoo's « Créer ». */
  createTag(name: string): Observable<PartnerTag> {
    return this.api.post<PartnerTag>('partners/tags/', { name });
  }

  /** The shared ISO catalogue (any signed-in user). */
  currencies(): Observable<Paginated<CurrencyOption>> {
    return this.api.get<Paginated<CurrencyOption>>('currencies/', {
      params: { page_size: OPTIONS_PAGE_SIZE },
      skipCompany: true,
    });
  }
}
