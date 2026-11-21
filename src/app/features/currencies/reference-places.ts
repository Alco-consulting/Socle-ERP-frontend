import { Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

import { SessionStore } from '../../core/session/session.store';
import { CurrenciesApi } from './data-access/currencies-api';

/** The decimals of the company's reference currency (GNF: none), read once. */
export function referencePlaces(): Signal<number> {
  const currency = inject(SessionStore).activeCompany()?.currency ?? '';
  return toSignal(
    inject(CurrenciesApi)
      .currencies()
      .pipe(
        map((page) => page.results.find((item) => item.code === currency)?.decimal_places ?? 0),
        catchError(() => of(0)),
      ),
    { initialValue: 0 },
  );
}
