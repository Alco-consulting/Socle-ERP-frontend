import { HttpErrorResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';

import { requestState } from './request-state';
import { envelope } from './testing';

function inContext<T>(factory: () => T): T {
  return runInInjectionContext(TestBed.inject(Injector), factory);
}

describe('requestState (local loading states)', () => {
  it('loading → loaded, keeping the value while reloading', () => {
    const source = new Subject<string[]>();
    const state = inContext(() => requestState(() => source, { isEmpty: (v) => v.length === 0 }));
    expect(state.status()).toBe('loading');
    source.next(['a']);
    expect(state.status()).toBe('loaded');
    expect(state.value()).toEqual(['a']);
    state.reload();
    expect(state.loading()).toBe(true);
    expect(state.value()).toEqual(['a']);
  });

  it('empty when the screen says so', () => {
    const source = new Subject<string[]>();
    const state = inContext(() => requestState(() => source, { isEmpty: (v) => v.length === 0 }));
    source.next([]);
    expect(state.status()).toBe('empty');
  });

  it('error vs forbidden, with the ApiError', () => {
    const error = inContext(() =>
      requestState(() =>
        throwError(() => new HttpErrorResponse({ status: 500, error: envelope('server_error') })),
      ),
    );
    expect(error.status()).toBe('error');
    expect(error.error()?.kind).toBe('server');

    const forbidden = inContext(() =>
      requestState(() =>
        throwError(
          () => new HttpErrorResponse({ status: 403, error: envelope('permission_denied') }),
        ),
      ),
    );
    expect(forbidden.status()).toBe('forbidden');
  });

  it('waits for reload() when not immediate', () => {
    const state = inContext(() => requestState(() => new Subject<number>(), { immediate: false }));
    expect(state.status()).toBe('idle');
    state.reload();
    expect(state.status()).toBe('loading');
  });
});
