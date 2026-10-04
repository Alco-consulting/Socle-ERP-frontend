import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  LetterableLine,
  LetterableLineFilters,
  Lettering,
  LetteringFilters,
  LetteringPreview,
  LetteringProposal,
  LetteringRequest,
  ProposalConfirmRequest,
} from './lettering-models';

/** Page size of the lettering lists (lines, letterings, proposals). */
export const LETTERING_PAGE_SIZE = 25;

const base = 'accounting/';
const id = (value: string) => encodeURIComponent(value);
const page = (value: number | undefined) => (value && value > 1 ? value : null);

/**
 * Lettering of the API (V2.1, lot A4), company scoped (`X-Company-ID` by the interceptor).
 * Every rule is the server's: which lines can be lettered, the amounts matched, the residual,
 * the proposals. A lettering is created by `POST letterings/` (or the confirmation of a
 * proposal) and cancelled by its `unletter/` command — never a status written here.
 */
@Injectable({ providedIn: 'root' })
export class LetteringApi {
  private readonly api = inject(ApiClient);

  /** Posted lines of the letterable accounts, oldest first. */
  lines(filters: LetterableLineFilters = {}): Observable<Paginated<LetterableLine>> {
    return this.api.get<Paginated<LetterableLine>>(`${base}letterable-lines/`, {
      params: {
        account: filters.account ?? null,
        partner: filters.partner ?? null,
        status: filters.status ?? null,
        date_from: filters.dateFrom ?? null,
        date_to: filters.dateTo ?? null,
        lettering: filters.lettering ?? null,
        page: page(filters.page),
        page_size: LETTERING_PAGE_SIZE,
      },
    });
  }

  /** Open lines of an account or a partner: the `count` of a one-row page (smart buttons). */
  openLineCount(filter: { account?: string; partner?: string }): Observable<number> {
    return this.api
      .get<Paginated<LetterableLine>>(`${base}letterable-lines/`, {
        params: {
          account: filter.account ?? null,
          partner: filter.partner ?? null,
          status: 'open',
          page_size: 1,
        },
      })
      .pipe(map((result) => result.count));
  }

  letterings(filters: LetteringFilters = {}): Observable<Paginated<Lettering>> {
    return this.api.get<Paginated<Lettering>>(`${base}letterings/`, {
      params: {
        account: filters.account ?? null,
        partner: filters.partner ?? null,
        status: filters.status ?? null,
        reference: filters.reference ?? null,
        date_from: filters.dateFrom ?? null,
        date_to: filters.dateTo ?? null,
        page: page(filters.page),
        page_size: LETTERING_PAGE_SIZE,
      },
    });
  }

  lettering(letteringId: string): Observable<Lettering> {
    return this.api.get<Lettering>(`${base}letterings/${id(letteringId)}/`);
  }

  /** What the lettering would do (`letterings/preview/`): nothing is written. */
  preview(request: LetteringRequest): Observable<LetteringPreview> {
    return this.api.post<LetteringPreview>(`${base}letterings/preview/`, request);
  }

  /** Letters the lines (manual). */
  letter(request: LetteringRequest): Observable<Lettering> {
    return this.api.post<Lettering>(`${base}letterings/`, request);
  }

  proposals(
    filters: { account?: string | null; partner?: string | null; page?: number } = {},
  ): Observable<Paginated<LetteringProposal>> {
    return this.api.get<Paginated<LetteringProposal>>(`${base}letterings/proposals/`, {
      params: {
        account: filters.account ?? null,
        partner: filters.partner ?? null,
        page: page(filters.page),
        page_size: LETTERING_PAGE_SIZE,
      },
    });
  }

  /** Letters a proposed pair (automatic), checked again by the server. */
  confirmProposal(request: ProposalConfirmRequest): Observable<Lettering> {
    return this.api.post<Lettering>(`${base}letterings/proposals/confirm/`, request);
  }

  /** Cancels a lettering (kept, with who, when, why): its amounts are open again. */
  unletter(letteringId: string, reason: string): Observable<Lettering> {
    return this.api.post<Lettering>(`${base}letterings/${id(letteringId)}/unletter/`, { reason });
  }
}
