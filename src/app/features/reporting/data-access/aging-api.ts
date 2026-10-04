import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from '../../../core/http/api-client';
import { AgedBalance, AgedPartner, AgingPolicy, AgingRole } from './aging-models';

/** Partners per page of the aged balance; documents per page of a partner. */
export const AGED_PAGE_SIZE = 50;
export const AGED_DOCUMENT_PAGE_SIZE = 200;

const id = (value: string) => encodeURIComponent(value);

export interface AgedQuery {
  readonly role: AgingRole;
  /** The reference date, chosen by the user (the server requires it). */
  readonly asOf: string;
  readonly page?: number;
}

/**
 * Reporting's aged balance (V2.1, lot A5), company scoped by the interceptor: the server
 * computes the open amounts on the reference date, the buckets and the totals; this service
 * only asks.
 */
@Injectable({ providedIn: 'root' })
export class AgingApi {
  private readonly api = inject(ApiClient);

  /** `reporting.read_auxiliary`. */
  agedBalance(query: AgedQuery): Observable<AgedBalance> {
    return this.api.get<AgedBalance>('reporting/aged-balance/', {
      params: {
        role: query.role,
        as_of: query.asOf,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: AGED_PAGE_SIZE,
      },
    });
  }

  /** One partner's open documents on the reference date. */
  agedPartner(partnerId: string, query: AgedQuery): Observable<AgedPartner> {
    return this.api.get<AgedPartner>(`reporting/aged-balance/partners/${id(partnerId)}/`, {
      params: {
        role: query.role,
        as_of: query.asOf,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: AGED_DOCUMENT_PAGE_SIZE,
      },
    });
  }

  policy(): Observable<AgingPolicy> {
    return this.api.get<AgingPolicy>('reporting/aging-policy/');
  }

  /** `reporting.manage_aging`: the server validates and stores the limits. */
  setPolicy(limits: readonly number[]): Observable<AgingPolicy> {
    return this.api.put<AgingPolicy>('reporting/aging-policy/', { limits });
  }
}
