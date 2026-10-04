import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from '../../../core/http/api-client';
import { AccountLedger, LedgerQuery, PartnerLedger } from './reporting-models';

/** Lines per page of a ledger. */
export const LEDGER_PAGE_SIZE = 50;

const id = (value: string) => encodeURIComponent(value);

/**
 * Reporting's ledgers (`reporting/`), company scoped by the interceptor: one experience of
 * the ledger, on the paginated report of the server (never the accounting module's
 * consultation ledger).
 */
@Injectable({ providedIn: 'root' })
export class ReportingApi {
  private readonly api = inject(ApiClient);

  /** `reporting.read`. */
  accountLedger(accountId: string, query: LedgerQuery): Observable<AccountLedger> {
    return this.api.get<AccountLedger>(`reporting/ledger/${id(accountId)}/`, {
      params: {
        fiscal_year: query.fiscalYear,
        include_descendants: query.includeDescendants ? true : null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: LEDGER_PAGE_SIZE,
      },
    });
  }

  /** `reporting.read_auxiliary`. */
  partnerLedger(partnerId: string, query: LedgerQuery): Observable<PartnerLedger> {
    return this.api.get<PartnerLedger>(`reporting/partners/${id(partnerId)}/ledger/`, {
      params: {
        fiscal_year: query.fiscalYear,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: LEDGER_PAGE_SIZE,
      },
    });
  }
}
