import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

import { ApiError, toApiError } from './api-error';

/** The explicit states of a screen (guide: loading, loaded, empty, error, forbidden). */
export type RequestStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error' | 'forbidden';

export interface RequestState<T> {
  readonly status: Signal<RequestStatus>;
  readonly value: Signal<T | null>;
  readonly error: Signal<ApiError | null>;
  /** True while (re)loading, including when previous data is still shown. */
  readonly loading: Signal<boolean>;
  /** Starts or restarts the request; a previous one still running is cancelled. */
  reload(): void;
}

export interface RequestStateOptions<T> {
  /** Loaded but nothing to show (empty list): the screen shows its empty state. */
  readonly isEmpty?: (value: T) => boolean;
  /** Start immediately (default) or wait for the first `reload()`. */
  readonly immediate?: boolean;
}

/**
 * Local loading state of one API read, for a list, a record or a dashboard block: the
 * screen maps each status to a design-system component (AlcoLoading, AlcoEmptyState,
 * AlcoErrorState). Previous data stays visible while reloading. Cancelled on destroy.
 * Call in an injection context (component field or constructor).
 */
export function requestState<T>(
  load: () => Observable<T>,
  options: RequestStateOptions<T> = {},
): RequestState<T> {
  const status = signal<RequestStatus>('idle');
  const value = signal<T | null>(null);
  const error = signal<ApiError | null>(null);
  let subscription: Subscription | null = null;

  inject(DestroyRef).onDestroy(() => subscription?.unsubscribe());

  const reload = () => {
    subscription?.unsubscribe();
    status.set('loading');
    error.set(null);
    subscription = load().subscribe({
      next: (result) => {
        value.set(result);
        status.set(options.isEmpty?.(result) ? 'empty' : 'loaded');
      },
      error: (failure: unknown) => {
        const apiError = toApiError(failure);
        error.set(apiError);
        status.set(apiError.kind === 'forbidden' ? 'forbidden' : 'error');
      },
    });
  };

  if (options.immediate ?? true) {
    reload();
  }

  return {
    status: status.asReadonly(),
    value: value.asReadonly(),
    error: error.asReadonly(),
    loading: computed(() => status() === 'loading'),
    reload,
  };
}
