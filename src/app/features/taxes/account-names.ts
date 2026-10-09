import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import { AccountingApi } from '../accounting/data-access/accounting-api';
import { RepartitionLine } from './data-access/taxes-models';

/**
 * Names of the chart's accounts used by repartition lines (« 445200 T.V.A. récupérable »):
 * one request per distinct code (a tax has a few), by code prefix, the exact code kept.
 * A code the chart does not know stays without a name.
 */
export function accountNames(
  api: AccountingApi,
  lines: readonly RepartitionLine[],
): Observable<ReadonlyMap<string, string>> {
  const codes = [...new Set(lines.map((line) => line.account_code).filter(Boolean))];
  if (codes.length === 0) {
    return of(new Map());
  }
  return forkJoin(
    codes.map((code) =>
      api.accounts({ codePrefix: code }).pipe(
        map((page) => page.results.find((account) => account.code === code)?.name ?? ''),
        catchError(() => of('')),
        map((name) => [code, name] as const),
      ),
    ),
  ).pipe(map((pairs) => new Map(pairs.filter(([, name]) => name))));
}
