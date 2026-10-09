import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import { NamedRecord, Tax, TaxQuery, TaxWrite } from './taxes-models';

/** A company has a few taxes: one page shows them all, as Odoo's list. */
export const TAX_PAGE_SIZE = 80;
const NAMES_PAGE_SIZE = 100;

const base = 'taxes/';
const id = (value: string) => encodeURIComponent(value);

/**
 * The company's taxes on the API (`X-Company-ID` by the interceptor). The server makes the
 * code, checks the repartition lines and writes the rules: the screens only send the form.
 */
@Injectable({ providedIn: 'root' })
export class TaxesApi {
  private readonly api = inject(ApiClient);

  taxes(query: TaxQuery = {}): Observable<Paginated<Tax>> {
    return this.api.get<Paginated<Tax>>(base, {
      params: {
        search: query.search || null,
        status: query.status ?? null,
        type_tax_use: query.uses?.length ? query.uses : null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: TAX_PAGE_SIZE,
      },
    });
  }

  tax(taxId: string): Observable<Tax> {
    return this.api.get<Tax>(`${base}${id(taxId)}/`);
  }

  createTax(tax: TaxWrite): Observable<Tax> {
    return this.api.post<Tax>(base, tax);
  }

  updateTax(taxId: string, changes: Partial<TaxWrite>): Observable<Tax> {
    return this.api.patch<Tax>(`${base}${id(taxId)}/`, changes);
  }

  /** Odoo's « Actif »: a command, never the form. */
  setTaxActive(taxId: string, active: boolean): Observable<Tax> {
    const command = active ? 'activate' : 'deactivate';
    return this.api.post<Tax>(`${base}${id(taxId)}/${command}/`);
  }

  /** The « Groupes de taxes » proposed by the form (a new name creates one). */
  headings(): Observable<readonly NamedRecord[]> {
    return this.names(`${base}headings/`);
  }

  /** The « Positions fiscales » proposed by the form (a new name creates one). */
  fiscalPositions(): Observable<readonly NamedRecord[]> {
    return this.names(`${base}fiscal-positions/`);
  }

  private names(path: string): Observable<readonly NamedRecord[]> {
    return this.api
      .get<Paginated<NamedRecord>>(path, { params: { page_size: NAMES_PAGE_SIZE } })
      .pipe(map((page) => page.results));
  }
}
