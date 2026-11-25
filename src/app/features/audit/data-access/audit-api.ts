import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';

/** `AuditEvent` (`before`/`after` only for `audit.read_sensitive`: not shown here). */
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
}

const PAGE_SIZE = 50;

/**
 * The journal of the backend's Audit, read for one object (oldest first). The object type is
 * the backend's model label (`accounting.journalentry`). No screen of its own here.
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
}
