import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import { DefaultTaxes, Tax, TaxQuery, TaxWrite } from './taxes-models';

/** A company has a few taxes: one page shows them all. */
export const TAX_PAGE_SIZE = 80;

const base = 'taxes/';
const id = (value: string) => encodeURIComponent(value);

/**
 * The company's taxes on the API (`X-Company-ID` by the interceptor). The server makes the
 * code, keeps only the accounts of the sides a tax applies to and writes its rule: the
 * screens only send the form.
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

  /** « Actif »: a command, never the form. */
  setTaxActive(taxId: string, active: boolean): Observable<Tax> {
    const command = active ? 'activate' : 'deactivate';
    return this.api.post<Tax>(`${base}${id(taxId)}/${command}/`);
  }

  /**
   * « Créer les taxes de Guinée »: the usual taxes of the company's country not yet
   * present, with the accounts of its chart (served by Accounting, which owns the chart).
   */
  createDefaultTaxes(): Observable<DefaultTaxes> {
    return this.api.post<DefaultTaxes>('accounting/default-taxes/');
  }
}
