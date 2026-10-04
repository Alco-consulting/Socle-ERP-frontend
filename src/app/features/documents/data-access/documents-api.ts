import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';

export type DocumentStatus = 'pending' | 'active' | 'replaced' | 'deleted' | 'failed';

/** `DocumentsDocument`: metadata only (the storage is never exposed). */
export interface StoredDocument {
  readonly public_id: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly original_name: string;
  readonly content_type: string;
  readonly size: number;
  readonly checksum: string;
  readonly description: string;
  readonly status: DocumentStatus;
  readonly replaces: string | null;
  readonly uploaded_by: string;
  readonly created_at: string;
  readonly deleted_by: string | null;
  readonly deleted_at: string | null;
  readonly deletion_reason: string;
}

/** `DocumentsDownload`: a signed link, short-lived, opened at once and never kept. */
export interface DocumentDownload {
  readonly url: string;
  readonly expires_at: string;
  readonly expires_in: number;
}

const PAGE_SIZE = 50;

/**
 * Documents of the API attached to a resource of a domain (`resource_type` registered by
 * the backend, e.g. `accounting.entry`). Company scoped by the interceptor.
 */
@Injectable({ providedIn: 'root' })
export class DocumentsApi {
  private readonly api = inject(ApiClient);

  /** The active documents of one resource. */
  attachedTo(resourceType: string, resourceId: string): Observable<Paginated<StoredDocument>> {
    return this.api.get<Paginated<StoredDocument>>('documents/', {
      params: { resource_type: resourceType, resource_id: resourceId, page_size: PAGE_SIZE },
    });
  }

  /** The server judges the file (format, size); multipart, CSRF by the interceptor. */
  upload(
    resourceType: string,
    resourceId: string,
    file: File,
    description = '',
  ): Observable<StoredDocument> {
    const data = new FormData();
    data.append('file', file, file.name);
    data.append('resource_type', resourceType);
    data.append('resource_id', resourceId);
    if (description) {
      data.append('description', description);
    }
    return this.api.upload<StoredDocument>('documents/', data);
  }

  downloadLink(documentId: string): Observable<DocumentDownload> {
    return this.api.get<DocumentDownload>(`documents/${encodeURIComponent(documentId)}/download/`);
  }
}
