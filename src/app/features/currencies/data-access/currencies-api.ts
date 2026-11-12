import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  Currency,
  CurrencyCreate,
  CurrencyQuery,
  CurrencyRate,
  CurrencyStatus,
  CurrencyWrite,
  RateWrite,
} from './currencies-models';

/** Odoo shows 80 currencies a page. */
export const CURRENCY_PAGE_SIZE = 80;
/** The rates of one currency, latest first. */
export const RATE_PAGE_SIZE = 20;

const base = 'currencies/';
const id = (value: string) => encodeURIComponent(value);

/**
 * The currencies on the API. The catalogue is shared by every company (no `X-Company-ID`;
 * changing it needs the global `currencies.create` / `currencies.update`); the rates belong to
 * the active company (`currencies.read`, `currencies.manage_rates`).
 */
@Injectable({ providedIn: 'root' })
export class CurrenciesApi {
  private readonly api = inject(ApiClient);

  /** The catalogue, the active currencies first (as Odoo lists them), then by code. */
  currencies(query: CurrencyQuery = {}): Observable<Paginated<Currency>> {
    return this.api.get<Paginated<Currency>>(base, {
      params: {
        search: query.search || null,
        status: query.status ?? null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: query.pageSize ?? CURRENCY_PAGE_SIZE,
      },
      skipCompany: true,
    });
  }

  currency(currencyId: string): Observable<Currency> {
    return this.api.get<Currency>(`${base}${id(currencyId)}/`, { skipCompany: true });
  }

  createCurrency(currency: CurrencyCreate): Observable<Currency> {
    return this.api.post<Currency>(base, currency, { skipCompany: true });
  }

  updateCurrency(
    currencyId: string,
    changes: Partial<CurrencyWrite> & { readonly status?: CurrencyStatus },
  ): Observable<Currency> {
    return this.api.patch<Currency>(`${base}${id(currencyId)}/`, changes, { skipCompany: true });
  }

  /** « Actif »: the catalogue's status (a company's reference currency stays active). */
  setCurrencyActive(currencyId: string, active: boolean): Observable<Currency> {
    return this.updateCurrency(currencyId, { status: active ? 'active' : 'inactive' });
  }

  /** The rate in force today of each currency, in the company's reference currency. */
  currentRates(): Observable<readonly CurrencyRate[]> {
    return this.api.get<readonly CurrencyRate[]>(`${base}rates/current/`);
  }

  /** The active rates of one currency, latest date first. */
  rates(code: string, page = 1): Observable<Paginated<CurrencyRate>> {
    return this.api.get<Paginated<CurrencyRate>>(`${base}rates/`, {
      params: {
        currency: code,
        status: 'active',
        page: page > 1 ? page : null,
        page_size: RATE_PAGE_SIZE,
      },
    });
  }

  recordRate(rate: RateWrite): Observable<CurrencyRate> {
    return this.api.post<CurrencyRate>(`${base}rates/`, rate);
  }

  /** A wrong rate is withdrawn (kept in the history, never changed), then entered again. */
  withdrawRate(rateId: string): Observable<CurrencyRate> {
    return this.api.post<CurrencyRate>(`${base}rates/${id(rateId)}/withdraw/`);
  }
}
