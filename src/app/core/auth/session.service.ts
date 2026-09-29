import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { CompanyContextService } from '../company/company-context.service';
import { ApiError } from '../http/api-error';
import { AuthFailures } from '../http/auth-failures';
import { SessionStore } from '../session/session.store';
import { AuthApi, CurrentUserDto } from './auth-api';

/**
 * - `unknown`: not checked yet (or the server could not be reached);
 * - `authenticated`: a Django session is open;
 * - `anonymous`: no session — the login screen;
 * - `expired`: the session ended while the user was working.
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous' | 'expired';

export const LOGIN_URL = '/login';

/** Query parameters of the login screen. */
export const LOGIN_REASON = 'raison';
export const LOGIN_RETURN = 'retour';

function displayName(user: CurrentUserDto): string {
  return `${user.first_name} ${user.last_name}`.trim() || user.email;
}

/**
 * The Django session seen from the front end. Asks the server once (`auth/me/`, then
 * `company-context/`), fills the `SessionStore`, and handles the end of the session:
 * - a « not authenticated » answer during work → state `expired`, one navigation to the
 *   login screen with the page to come back to; never a loop, never repeated calls;
 * - a 403 permission refusal is not an end of session (handled by the screen).
 * With `sessionSource: 'prototype'` the simulated session is used and nothing is called.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly config = inject(APP_CONFIG);
  private readonly authApi = inject(AuthApi);
  private readonly companies = inject(CompanyContextService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);

  private readonly state = signal<SessionStatus>(
    this.config.sessionSource === 'prototype' ? 'authenticated' : 'unknown',
  );
  readonly status = this.state.asReadonly();
  private loading: Promise<boolean> | null = null;

  constructor() {
    inject(AuthFailures)
      .unauthenticated$.pipe(takeUntilDestroyed())
      .subscribe(() => this.expire());
  }

  /**
   * Whether a session is open, asking the server at most once. Rejects with an `ApiError`
   * when the server cannot answer (the caller shows « unavailable », not the login).
   */
  ensureLoaded(): Promise<boolean> {
    switch (this.state()) {
      case 'authenticated':
        return Promise.resolve(true);
      case 'anonymous':
      case 'expired':
        return Promise.resolve(false);
      default:
        this.loading ??= this.load().finally(() => (this.loading = null));
        return this.loading;
    }
  }

  /** The server no longer recognises the session: once, back to the login screen. */
  expire(): void {
    if (this.config.sessionSource === 'prototype' || this.state() !== 'authenticated') {
      return;
    }
    this.state.set('expired');
    this.store.clear();
    const current = this.router.url;
    if (!current.startsWith(LOGIN_URL)) {
      void this.router.navigate([LOGIN_URL], {
        queryParams: { [LOGIN_REASON]: 'session-expiree', [LOGIN_RETURN]: current },
      });
    }
  }

  /** Ends the Django session, then the login screen. */
  async logout(): Promise<void> {
    if (this.config.sessionSource === 'api') {
      await firstValueFrom(this.authApi.logout());
    }
    this.state.set('anonymous');
    this.store.clear();
    await this.router.navigateByUrl(LOGIN_URL);
  }

  /** After a successful login (Authentication module): reload user and company context. */
  async restart(): Promise<boolean> {
    this.state.set('unknown');
    this.loading = null;
    return this.ensureLoaded();
  }

  private async load(): Promise<boolean> {
    let user: CurrentUserDto;
    try {
      user = await firstValueFrom(this.authApi.me());
    } catch (failure) {
      if (failure instanceof ApiError && failure.kind === 'unauthenticated') {
        this.state.set('anonymous');
        return false;
      }
      throw failure;
    }
    this.store.load({
      user: { displayName: displayName(user), email: user.email },
      globalPermissions: user.permissions,
      companies: [],
      activeCompanyId: '',
    });
    await this.companies.load();
    this.state.set('authenticated');
    return true;
  }
}
