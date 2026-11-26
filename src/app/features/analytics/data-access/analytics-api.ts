import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  AnalyticAxis,
  AnalyticRule,
  AnalyticStatus,
  AnalyticValue,
  AxisReport,
  RuleWrite,
} from './analytics-models';

const PAGE_SIZE = 200;
const base = 'analytics/';
const id = (value: string) => encodeURIComponent(value);

/** Plans, their accounts and the distribution models of the API (note backend 0063). */
@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly api = inject(ApiClient);

  axes(status: AnalyticStatus | null = null): Observable<readonly AnalyticAxis[]> {
    return this.api
      .get<Paginated<AnalyticAxis>>(`${base}axes/`, { params: { status, page_size: PAGE_SIZE } })
      .pipe(map((page) => page.results));
  }

  axis(axisId: string): Observable<AnalyticAxis> {
    return this.api.get<AnalyticAxis>(`${base}axes/${id(axisId)}/`);
  }

  /** Its code is made from its name by the server (note backend 0064). */
  createAxis(name: string): Observable<AnalyticAxis> {
    return this.api.post<AnalyticAxis>(`${base}axes/`, { name });
  }

  renameAxis(axisId: string, name: string): Observable<AnalyticAxis> {
    return this.api.patch<AnalyticAxis>(`${base}axes/${id(axisId)}/`, { name });
  }

  setAxisActive(axisId: string, active: boolean): Observable<AnalyticAxis> {
    const command = active ? 'reactivate' : 'deactivate';
    return this.api.post<AnalyticAxis>(`${base}axes/${id(axisId)}/${command}/`);
  }

  /** The accounts of a plan, or of every plan; `active` only for a choice. */
  values(axisId: string | null, status: AnalyticStatus | null = null) {
    return this.api
      .get<Paginated<AnalyticValue>>(`${base}values/`, {
        params: { axis: axisId, status, page_size: PAGE_SIZE },
      })
      .pipe(map((page) => page.results));
  }

  createValue(axisId: string, label: string): Observable<AnalyticValue> {
    return this.api.post<AnalyticValue>(`${base}values/`, { axis: axisId, label });
  }

  setValueActive(valueId: string, active: boolean): Observable<AnalyticValue> {
    const command = active ? 'reactivate' : 'deactivate';
    return this.api.post<AnalyticValue>(`${base}values/${id(valueId)}/${command}/`);
  }

  rules(): Observable<readonly AnalyticRule[]> {
    return this.api
      .get<Paginated<AnalyticRule>>(`${base}rules/`, { params: { page_size: PAGE_SIZE } })
      .pipe(map((page) => page.results));
  }

  rule(ruleId: string): Observable<AnalyticRule> {
    return this.api.get<AnalyticRule>(`${base}rules/${id(ruleId)}/`);
  }

  createRule(rule: RuleWrite): Observable<AnalyticRule> {
    return this.api.post<AnalyticRule>(`${base}rules/`, rule);
  }

  /** The name, the prefix and the lines; the code and the plan stay. */
  updateRule(ruleId: string, rule: RuleWrite): Observable<AnalyticRule> {
    return this.api.patch<AnalyticRule>(`${base}rules/${id(ruleId)}/`, {
      name: rule.name,
      account_prefix: rule.account_prefix,
      lines: rule.lines,
    });
  }

  setRuleActive(ruleId: string, active: boolean): Observable<AnalyticRule> {
    const command = active ? 'reactivate' : 'deactivate';
    return this.api.post<AnalyticRule>(`${base}rules/${id(ruleId)}/${command}/`);
  }

  /** What each account of a plan received over the dates (posted entries only). */
  axisReport(axisId: string, dateFrom: string, dateTo: string): Observable<AxisReport> {
    return this.api.get<AxisReport>(`reporting/analytics/axes/${id(axisId)}/`, {
      params: { date_from: dateFrom, date_to: dateTo, page_size: PAGE_SIZE },
    });
  }
}
