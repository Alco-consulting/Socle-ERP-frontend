import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiConfig } from '../http/api-config';
import { requestContext } from '../http/http-context';
import { COMPANY_HEADER } from '../http/interceptors';

/** `CompaniesCompanySummary` (OpenAPI). */
export interface CompanySummaryDto {
  readonly public_id: string;
  readonly legal_name: string;
  readonly trade_name: string;
  readonly country: string;
  readonly reference_currency: string;
  readonly status: 'active' | 'inactive';
}

/** `CompaniesCompanyContext`: current company (with its permissions), default, accessible. */
export interface CompanyContextDto {
  readonly current: {
    readonly company: CompanySummaryDto;
    readonly permissions: readonly string[];
  } | null;
  readonly default_company: string | null;
  readonly companies: readonly CompanySummaryDto[];
}

/** `CompaniesDefaultCompanyResult`. */
export interface DefaultCompanyDto {
  readonly default_company: string;
}

/**
 * The company context endpoints (backend/docs/api/openapi.yaml):
 * - `GET company-context/`: the company named by `X-Company-ID` (else the user's default,
 *   else none) with the permissions in it, the default company and the accessible ones.
 *   The server validates the identifier: a refused one (unknown, inaccessible, inactive — the
 *   same answer) is a 403 `company_access_denied`, never a silent fallback.
 * - `PUT company-context/default/`: the user's default company (a membership is required).
 */
@Injectable({ providedIn: 'root' })
export class CompanyApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfig);

  context(companyId: string | null): Observable<CompanyContextDto> {
    return this.http.get<CompanyContextDto>(this.api.url('company-context/'), {
      // The requested company, not the active one: the header is set here on purpose.
      headers: companyId ? new HttpHeaders({ [COMPANY_HEADER]: companyId }) : undefined,
      context: requestContext({ skipCompany: true }),
    });
  }

  setDefault(companyId: string): Observable<DefaultCompanyDto> {
    return this.http.put<DefaultCompanyDto>(
      this.api.url('company-context/default/'),
      { company: companyId },
      { context: requestContext({ skipCompany: true }) },
    );
  }
}
