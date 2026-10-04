import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';

/** The objects an entry count can be narrowed to (the entry list's own filters). */
export interface EntryCountFilter {
  /** Public ids, as `GET accounting/entries/` takes them. */
  readonly journal?: string;
  readonly account?: string;
  readonly partner?: string;
  readonly fiscalYear?: string;
}

/** `AccountingCollectiveAccount`: a collective account code of a partner, checked by the server. */
export interface CollectiveAccount {
  readonly role: 'customer' | 'supplier' | string;
  readonly code: string;
  /** The account of that code in the chart (`null` when the chart has none). */
  readonly account: { readonly public_id: string; readonly code: string } | null;
  readonly postable: boolean;
}

/**
 * Relations between accounting objects, for the smart buttons of a record: one request per
 * relation, never one per related object. Company scoped by the interceptor.
 */
@Injectable({ providedIn: 'root' })
export class RelationsApi {
  private readonly api = inject(ApiClient);

  /** Entries of a status (all without one) of an object: the `count` of a one-row page. */
  entryCount(status: string | null, filter: EntryCountFilter): Observable<number> {
    return this.api
      .get<Paginated<unknown>>('accounting/entries/', {
        params: {
          status,
          journal: filter.journal ?? null,
          account: filter.account ?? null,
          partner: filter.partner ?? null,
          fiscal_year: filter.fiscalYear ?? null,
          page_size: 1,
        },
      })
      .pipe(map((page) => page.count));
  }

  /** A partner's collective accounts (`accounting/partners/<id>/accounts/`). */
  collectiveAccounts(partnerId: string): Observable<readonly CollectiveAccount[]> {
    return this.api.get<readonly CollectiveAccount[]>(
      `accounting/partners/${encodeURIComponent(partnerId)}/accounts/`,
    );
  }
}
