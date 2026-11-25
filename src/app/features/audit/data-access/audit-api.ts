import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';

/** `AuditEvent`: `before`/`after` are `null` without `audit.read_sensitive`. */
export interface AuditEvent {
  readonly public_id: string;
  readonly occurred_at: string;
  readonly action: string;
  readonly object_type: string;
  readonly object_id: string;
  readonly object_label: string;
  readonly user: { readonly public_id: string; readonly email: string } | null;
  readonly origin: string;
  readonly source: string;
  readonly correlation_id: string;
  readonly metadata: unknown;
  readonly changed_fields: readonly string[];
  readonly before?: Readonly<Record<string, unknown>> | null;
  readonly after?: Readonly<Record<string, unknown>> | null;
}

/** Filters of the company's journal (`GET audit/events/`); dates are UTC days, included. */
export interface AuditQuery {
  readonly action?: string;
  readonly objectType?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly search?: string;
  readonly page?: number;
}

const PAGE_SIZE = 50;
export const JOURNAL_PAGE_SIZE = 50;

/**
 * The journal of the backend's Audit: the company's events (newest first) or one object's
 * (oldest first). The object type is the backend's model label (`accounting.journalentry`).
 */
@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly api = inject(ApiClient);

  history(objectType: string, objectId: string, page = 1): Observable<Paginated<AuditEvent>> {
    return this.api.get<Paginated<AuditEvent>>(
      `audit/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}/`,
      { params: { page: page > 1 ? page : null, page_size: PAGE_SIZE } },
    );
  }

  events(query: AuditQuery = {}): Observable<Paginated<AuditEvent>> {
    return this.api.get<Paginated<AuditEvent>>('audit/events/', {
      params: {
        action: query.action || null,
        object_type: query.objectType || null,
        date_from: query.dateFrom || null,
        date_to: query.dateTo || null,
        search: query.search || null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: JOURNAL_PAGE_SIZE,
      },
    });
  }

  event(eventId: string): Observable<AuditEvent> {
    return this.api.get<AuditEvent>(`audit/events/${encodeURIComponent(eventId)}/`);
  }
}
