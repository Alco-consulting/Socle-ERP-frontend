import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';

/** The fields of `TreasuryOperation` this front end shows (the rest is not read). */
export interface TreasuryOperationSummary {
  readonly public_id: string;
  readonly treasury_account: { readonly public_id: string; readonly code: string };
  readonly operation_type: string;
  readonly direction: 'inflow' | 'outflow';
  readonly status: 'draft' | 'confirmed' | 'accounted' | 'cancelled';
  readonly operation_date: string;
  readonly amount: string;
  readonly currency: string;
  readonly reference: string;
}

/** Treasury of the API (`treasury/`), company scoped by the interceptor. Read only here. */
@Injectable({ providedIn: 'root' })
export class TreasuryApi {
  private readonly api = inject(ApiClient);

  /** The operations accounted by an entry (`?accounting_entry=`): its treasury side. */
  operationsOfEntry(entryId: string): Observable<Paginated<TreasuryOperationSummary>> {
    return this.api.get<Paginated<TreasuryOperationSummary>>('treasury/operations/', {
      params: { accounting_entry: entryId, page_size: 10 },
    });
  }
}
