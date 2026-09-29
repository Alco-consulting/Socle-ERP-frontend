import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable, Subject, firstValueFrom } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { CompanyContextService } from '../company/company-context.service';
import { ApiError, toApiError } from '../http/api-error';
import { AuthFailures } from '../http/auth-failures';
import { NotificationCenter } from '../notifications/notification-center';
import { SessionStatus, SessionStore } from '../session/session.store';
import { AuthApi, CurrentUserDto } from './auth-api';

export type { SessionStatus } from '../session/session.store';

export const LOGIN_URL = '/login';

/** Query parameters of the login screen. */
export const LOGIN_REASON = 'raison';
export const LOGIN_RETURN = 'retour';

/** Why the login screen is shown (`?raison=`). */
export type LoginReason = 'session-expiree' | 'indisponible' | 'deconnexion';

function displayName(user: CurrentUserDto): string {
  return `${user.first_name} ${user.last_name}`.trim() || user.email;
}

/**
 * The Django session seen from the front end — the only writer of the `SessionStore`.
 * - Start: asks the server once (`auth/me/`, then `company-context/`).
 * - Login: `POST auth/login/` (CSRF by the interceptor), the answer IS the current user (no
 *   second `auth/me/`), then the company context. One attempt at a time.
 * - Logout: `POST auth/logout/` (CSRF), then everything tied to the session is forgotten.
 * - End of session during work (403 `not_authenticated`): state `expired`, one navigation to
 *   the login screen with the page to come back to; never a loop, never repeated calls.
 * - A 403 permission refusal is not an end of session.
 * With `sessionSource: 'prototype'` the simulated session is used and nothing is called.
 * The browser keeps the session cookie (HttpOnly): no token is ever read or stored here.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly config = inject(APP_CONFIG);
  private readonly authApi = inject(AuthApi);
  private readonly companies = inject(CompanyContextService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationCenter);

  readonly status = this.store.status;
  private loading: Promise<boolean> | null = null;
  private signingIn: Promise<void> | null = null;
  private readonly ended = new Subject<void>();

  /**
   * Emits when the session ends (logout, expiry): a feature keeping data of the session in
   * memory (cache of a list…) forgets it here.
   */
  readonly ended$: Observable<void> = this.ended.asObservable();

  constructor() {
    if (this.config.sessionSource === 'prototype') {
      this.store.setStatus('authenticated');
    }
    inject(AuthFailures)
      .unauthenticated$.pipe(takeUntilDestroyed())
      .subscribe(() => this.expire());
  }

  /**
   * Whether a session is open, asking the server at most once. Rejects with an `ApiError`
   * when the server cannot answer (the caller shows « unavailable », not the login).
   */
  ensureLoaded(): Promise<boolean> {
    switch (this.store.status()) {
      case 'authenticated':
        return Promise.resolve(true);
      case 'anonymous':
      case 'expired':
        return Promise.resolve(false);
      default:
        this.loading ??= this.load().finally(() => {
          this.loading = null;
          this.store.setActivity(null);
        });
        return this.loading;
    }
  }

  /**
   * Opens a Django session. Resolves once the user and the company context are loaded;
   * rejects with the `ApiError` of the server (`invalid_credentials`, `throttled`…).
   * A second call while one is running joins it: one request per logical click.
   */
  login(email: string, password: string): Promise<void> {
    this.signingIn ??= this.signIn(email, password).finally(() => {
      this.signingIn = null;
      this.store.setActivity(null);
    });
    return this.signingIn;
  }

  /** The server no longer recognises the session: once, back to the login screen. */
  expire(): void {
    if (this.config.sessionSource === 'prototype' || this.store.status() !== 'authenticated') {
      return;
    }
    this.end('expired');
    const current = this.router.url;
    if (!current.startsWith(LOGIN_URL)) {
      void this.router.navigate([LOGIN_URL], {
        queryParams: { [LOGIN_REASON]: 'session-expiree', [LOGIN_RETURN]: current },
      });
    }
  }

  /**
   * Ends the Django session, then the login screen. A server failure keeps the session
   * (the user may retry); a session already ended counts as logged out.
   */
  async logout(): Promise<void> {
    if (this.config.sessionSource === 'api') {
      this.store.setActivity('signing-out');
      try {
        await firstValueFrom(this.authApi.logout());
      } catch (failure) {
        const error = toApiError(failure);
        if (error.kind !== 'unauthenticated') {
          this.store.setActivity(null);
          throw error;
        }
      }
    }
    this.end('anonymous');
    await this.router.navigate([LOGIN_URL], { queryParams: { [LOGIN_REASON]: 'deconnexion' } });
  }

  private async signIn(email: string, password: string): Promise<void> {
    if (this.config.sessionSource === 'prototype') {
      return;
    }
    this.store.setActivity('signing-in');
    this.store.setError(null);
    const user = await firstValueFrom(this.authApi.login(email, password));
    await this.open(user);
  }

  private async load(): Promise<boolean> {
    this.store.setActivity('checking');
    let user: CurrentUserDto;
    try {
      user = await firstValueFrom(this.authApi.me());
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        this.store.setStatus('anonymous');
        this.store.setError(null);
        return false;
      }
      this.store.setError(error);
      throw error;
    }
    await this.open(user);
    return true;
  }

  /** User known: company context, then the session is open. */
  private async open(user: CurrentUserDto): Promise<void> {
    this.store.load({
      user: { displayName: displayName(user), email: user.email },
      globalPermissions: user.permissions,
      companies: [],
      activeCompanyId: '',
    });
    try {
      await this.companies.load();
    } catch (failure) {
      const error: ApiError = toApiError(failure);
      this.store.clear();
      this.store.setStatus('unknown');
      this.store.setError(error);
      throw error;
    }
    this.store.setError(null);
    this.store.setStatus('authenticated');
  }

  /** Forgets everything tied to the session (the HttpOnly cookie is the server's business). */
  private end(status: SessionStatus): void {
    this.store.clear();
    this.store.setStatus(status);
    this.store.setActivity(null);
    this.store.setError(null);
    this.companies.forget();
    this.notifications.load([]);
    this.loading = null;
    this.ended.next();
  }
}
