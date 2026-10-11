import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import { ClosingRun, ClosingStep, RunPeriod, StepCode } from './closing-models';

export const RUN_PAGE_SIZE = 50;

const base = 'closing/runs/';
const id = (value: string) => encodeURIComponent(value);

/**
 * The closings of the active company (`closing.read`). Each command checks its own
 * permission on the server: `start`, `execute`, `validate`, `close`, `reopen`.
 */
@Injectable({ providedIn: 'root' })
export class ClosingApi {
  private readonly api = inject(ApiClient);

  runs(page = 1): Observable<Paginated<ClosingRun>> {
    return this.api.get<Paginated<ClosingRun>>(base, {
      params: { page: page > 1 ? page : null, page_size: RUN_PAGE_SIZE },
    });
  }

  run(runId: string): Observable<ClosingRun> {
    return this.api.get<ClosingRun>(`${base}${id(runId)}/`);
  }

  /** The closing of a fiscal year: its ten steps, in order. */
  startYear(fiscalYearId: string): Observable<ClosingRun> {
    return this.api.post<ClosingRun>(base, { fiscal_year: fiscalYearId });
  }

  steps(runId: string): Observable<readonly ClosingStep[]> {
    return this.api.get<readonly ClosingStep[]>(`${base}${id(runId)}/steps/`);
  }

  /** Runs a step, or retries a failed one; its checks come back with it. */
  execute(runId: string, code: StepCode, retry = false): Observable<ClosingStep> {
    const command = retry ? 'retry' : 'execute';
    return this.api.post<ClosingStep>(`${base}${id(runId)}/steps/${code}/${command}/`, {});
  }

  /** The periods of the closing's scope and their state. */
  periods(runId: string): Observable<readonly RunPeriod[]> {
    return this.api.get<readonly RunPeriod[]>(`${base}${id(runId)}/periods/`);
  }

  cancel(runId: string, reason: string): Observable<ClosingRun> {
    return this.api.post<ClosingRun>(`${base}${id(runId)}/cancel/`, { reason });
  }

  /** A fiscal year's closing reopens the fiscal year alone (note backend 0036). */
  reopen(runId: string, reason: string): Observable<ClosingRun> {
    return this.api.post<ClosingRun>(`${base}${id(runId)}/reopen/`, { reason });
  }

  /** One period of a fiscal year whose closing was reopened. */
  reopenPeriod(runId: string, periodId: string, reason: string): Observable<ClosingRun> {
    return this.api.post<ClosingRun>(`${base}${id(runId)}/periods/${id(periodId)}/reopen/`, {
      reason,
    });
  }
}
