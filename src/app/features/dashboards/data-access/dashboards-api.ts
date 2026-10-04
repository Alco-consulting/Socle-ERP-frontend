import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from '../../../core/http/api-client';
import { DashboardAlerts, JournalsDashboard } from './dashboard-models';

/**
 * The dashboards of the API (`dashboards/`), company scoped by the interceptor. Read only:
 * every figure is the server's, never rebuilt from other endpoints.
 */
@Injectable({ providedIn: 'root' })
export class DashboardsApi {
  private readonly api = inject(ApiClient);

  /**
   * Active journals with their entry counts and, when the treasury is readable, their
   * treasury accounts (balance at `on`). One request for every journal.
   */
  journals(on: string, fiscalYear: string | null = null): Observable<JournalsDashboard> {
    return this.api.get<JournalsDashboard>('dashboards/journals/', {
      params: { on, fiscal_year: fiscalYear },
    });
  }

  /** Alerts and indicators over a Reporting scope (the API never implies a date). */
  alerts(dateFrom: string, dateTo: string): Observable<DashboardAlerts> {
    return this.api.get<DashboardAlerts>('dashboards/alerts/', {
      params: { date_from: dateFrom, date_to: dateTo },
    });
  }
}
