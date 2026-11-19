import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  Declaration,
  DeclarationCommand,
  DeclarationDetail,
  DefaultTaxes,
  Tax,
  TaxQuery,
  TaxSettings,
  TaxWrite,
} from './taxes-models';

/** A company has a few taxes: one page shows them all. */
export const TAX_PAGE_SIZE = 80;

/** One declaration a month: two years on a page. */
export const DECLARATION_PAGE_SIZE = 24;

const base = 'taxes/';
const declarations = 'taxes/declarations/';
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
        page_size: query.pageSize ?? TAX_PAGE_SIZE,
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

  settings(): Observable<TaxSettings> {
    return this.api.get<TaxSettings>(`${base}settings/`);
  }

  /** `taxes.update` (the server checks). */
  saveSettings(settings: TaxSettings): Observable<TaxSettings> {
    return this.api.put<TaxSettings>(`${base}settings/`, settings);
  }

  // ---- Declarations (VAT computed by the server from the posted entries) --------------

  declarations(page = 1): Observable<Paginated<Declaration>> {
    return this.api.get<Paginated<Declaration>>(declarations, {
      params: { page: page > 1 ? page : null, page_size: DECLARATION_PAGE_SIZE },
    });
  }

  declaration(declarationId: string): Observable<DeclarationDetail> {
    return this.api.get<DeclarationDetail>(`${declarations}${id(declarationId)}/`);
  }

  /** The VAT of a period; the server fills the amount due from the entries. */
  createDeclaration(periodStart: string, periodEnd: string): Observable<Declaration> {
    return this.api.post<Declaration>(declarations, {
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  /** The amount written on the tax form, until the declaration is validated. */
  setDeclaredAmount(declarationId: string, amount: string): Observable<DeclarationDetail> {
    return this.api.patch<DeclarationDetail>(`${declarations}${id(declarationId)}/`, {
      declared_amount: amount,
    });
  }

  runDeclarationStep(
    declarationId: string,
    command: DeclarationCommand,
  ): Observable<DeclarationDetail> {
    return this.api.post<DeclarationDetail>(`${declarations}${id(declarationId)}/${command}/`);
  }
}
