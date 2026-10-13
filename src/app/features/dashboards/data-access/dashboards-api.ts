import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from '../../../core/http/api-client';
import { JournalsDashboard } from './dashboard-models';

/**
 * The dashboards of the API (`dashboards/`), company scoped by the interceptor. Read only:
 * every figure is the server's, never rebuilt from other endpoints.
 */
@Injectable({ providedIn: 'root' })
export class DashboardsApi {
  private readonly api = inject(ApiClient);

  /**
   * Active journals with their entry counts, their treasury accounts (balance at `on` and its
   * curve) and their documents (due weeks from `on`). One request for every journal.
   */
  journals(on: string, fiscalYear: string | null = null): Observable<JournalsDashboard> {
    return this.api.get<JournalsDashboard>('dashboards/journals/', {
      params: { on, fiscal_year: fiscalYear },
    });
  }
}
