import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  DueItem,
  DueItemDetail,
  DueItemFilters,
  DueSchedule,
  PendingLine,
  PendingLineFilters,
  RecomputeRequest,
} from './due-models';

/** Page size of the due dates lists. */
export const DUE_PAGE_SIZE = 25;

const base = 'accounting/';
const id = (value: string) => encodeURIComponent(value);
const page = (value: number | undefined) => (value && value > 1 ? value : null);

/**
 * Due dates of the API (V2.1, lot A5), company scoped by the interceptor. The server
 * computes and stores the installments, settles them from the lettering and decides what is
 * open; generating and recomputing are its commands — nothing is computed here.
 */
@Injectable({ providedIn: 'root' })
export class DueApi {
  private readonly api = inject(ApiClient);

  items(filters: DueItemFilters = {}): Observable<Paginated<DueItem>> {
    return this.api.get<Paginated<DueItem>>(`${base}due-items/`, {
      params: {
        partner: filters.partner ?? null,
        account: filters.account ?? null,
        role: filters.role ?? null,
        status: filters.status ?? null,
        due_from: filters.dueFrom ?? null,
        due_to: filters.dueTo ?? null,
        entry: filters.entry ?? null,
        page: page(filters.page),
        page_size: DUE_PAGE_SIZE,
      },
    });
  }

  /** A partner's installments: the `count` of a one-row page (smart button). */
  itemCount(partnerId: string): Observable<number> {
    return this.api
      .get<Paginated<DueItem>>(`${base}due-items/`, {
        params: { partner: partnerId, page_size: 1 },
      })
      .pipe(map((result) => result.count));
  }

  item(itemId: string): Observable<DueItemDetail> {
    return this.api.get<DueItemDetail>(`${base}due-items/${id(itemId)}/`);
  }

  schedule(scheduleId: string): Observable<DueSchedule> {
    return this.api.get<DueSchedule>(`${base}due-schedules/${id(scheduleId)}/`);
  }

  pendingLines(filters: PendingLineFilters = {}): Observable<Paginated<PendingLine>> {
    return this.api.get<Paginated<PendingLine>>(`${base}due-schedules/pending-lines/`, {
      params: {
        role: filters.role ?? null,
        partner: filters.partner ?? null,
        account: filters.account ?? null,
        date_from: filters.dateFrom ?? null,
        date_to: filters.dateTo ?? null,
        page: page(filters.page),
        page_size: DUE_PAGE_SIZE,
      },
    });
  }

  /** Generates the due dates of these lines (all or none): the server's schedules. */
  generate(lines: readonly string[]): Observable<readonly DueSchedule[]> {
    return this.api.post<readonly DueSchedule[]>(`${base}due-schedules/`, { lines });
  }

  /** Recomputes a schedule (reason required), audited by the server. */
  recompute(scheduleId: string, request: RecomputeRequest): Observable<DueSchedule> {
    return this.api.post<DueSchedule>(`${base}due-schedules/${id(scheduleId)}/recompute/`, request);
  }
}
