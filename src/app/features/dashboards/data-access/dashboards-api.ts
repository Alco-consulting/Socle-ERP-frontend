import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from '../../../core/http/api-client';
import { DashboardScope, JournalsDashboard, OverviewDashboard } from './dashboard-models';

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
  /** The headline metrics (results, cash, receivables, payables) over a scope. */
  overview(scope: DashboardScope): Observable<OverviewDashboard> {
    return this.api.get<OverviewDashboard>('dashboards/overview/', { params: { ...scope } });
  }

  journals(on: string, fiscalYear: string | null = null): Observable<JournalsDashboard> {
    return this.api.get<JournalsDashboard>('dashboards/journals/', {
      params: { on, fiscal_year: fiscalYear },
    });
  }
}
