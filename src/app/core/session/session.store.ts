import { Injectable, computed, signal } from '@angular/core';

import type { ApiError } from '../http/api-error';

/**
 * - `unknown`: not checked yet (or the server could not be reached);
 * - `authenticated`: a Django session is open;
 * - `anonymous`: no session — the login screen;
 * - `expired`: the session ended while the user was working.
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous' | 'expired';

/** What the session is doing right now (`null` = nothing). */
export type SessionActivity =
  'checking' | 'signing-in' | 'signing-out' | 'switching-company' | null;

export interface SessionUser {
  readonly displayName: string;
  readonly email: string;
}

/** A company the user may enter (`CompanySummarySerializer` of the backend). */
export interface CompanySummary {
  /** `public_id` of the company: the value of `X-Company-ID`. */
  readonly id: string;
  /** Trade name, else legal name. */
  readonly name: string;
  readonly legalName: string;
  readonly country: string;
  readonly currency: string;
  /** `false`: an inactive company, listed for a platform administrator only. */
  readonly active: boolean;
}

/** What `company-context/` says, as the interface uses it. */
export interface CompanyContext {
  /** The companies the user may enter, as the server lists them. */
  readonly companies: readonly CompanySummary[];
  /** The user's default company (server side, `PUT company-context/default/`). */
  readonly defaultCompanyId: string | null;
  /** The active company; `null` = none chosen yet (the user chooses, `/societe`). */
  readonly activeCompanyId: string | null;
  /** Permissions of the user in the active company only (backend codes). */
  readonly permissions: readonly string[];
  /**
   * Optional functional domains the active company uses (`treasury`, `assets`, `loans`,
   * `taxes`, `analytics`). `null` = not configured, nothing hidden: the backend has no such
   * setting yet, so every domain follows the permissions only.
   */
  readonly features: readonly string[] | null;
}

export interface SessionSnapshot {
  readonly user: SessionUser;
  /** Permissions of the user outside any company, from `auth/me/`. */
  readonly globalPermissions: readonly string[];
}

/**
 * Whether a permission holds outside any company. Backend rule (companies/policies.py): the
 * `users.*` permissions and `companies.create` are global and never granted in a company;
 * every other one is read in the membership of the active company ONLY — a global grant of
 * it (a platform administrator holds them all) never applies there.
 */
export function isGlobalPermission(code: string): boolean {
  return code.startsWith('users.') || code === 'companies.create';
}

const NO_COMPANY: CompanyContext = {
  companies: [],
  defaultCompanyId: null,
  activeCompanyId: null,
  permissions: [],
  features: null,
};

/**
 * The single store of the session: status, current activity and last session error, who
 * is connected, the companies they may enter, the active one and the permissions in it.
 * UX only: hiding what the user cannot do; the backend remains the authority on every
 * request. Written by `SessionService` and `CompanyContextService`; read everywhere.
 * Never holds a token or a password: the session is an HttpOnly cookie of the browser.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly state = signal<SessionSnapshot | null>(null);
  private readonly context = signal<CompanyContext>(NO_COMPANY);
  private readonly statusState = signal<SessionStatus>('unknown');
  private readonly activityState = signal<SessionActivity>(null);
  private readonly errorState = signal<ApiError | null>(null);

  readonly status = this.statusState.asReadonly();
  readonly authenticated = computed(() => this.statusState() === 'authenticated');
  /** A session request is running (check, login, logout, company switch). */
  readonly activity = this.activityState.asReadonly();
  /** Last failure of a session request (unreachable server…); `null` after a success. */
  readonly error = this.errorState.asReadonly();

  readonly user = computed(() => this.state()?.user ?? null);
  readonly companies = computed(() => this.context().companies);
  readonly defaultCompanyId = computed(() => this.context().defaultCompanyId);
  readonly activeCompany = computed(() => {
    const context = this.context();
    return context.companies.find((company) => company.id === context.activeCompanyId) ?? null;
  });
  /** The global permissions that hold everywhere, plus those of the active company. */
  readonly permissions = computed(
    () =>
      new Set([
        ...(this.state()?.globalPermissions ?? []).filter(isGlobalPermission),
        ...(this.activeCompany() ? this.context().permissions : []),
      ]),
  );
  readonly initials = computed(() =>
    (this.user()?.displayName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join(''),
  );

  /** Who is connected; the company context comes next (`setCompanyContext`). */
  load(snapshot: SessionSnapshot): void {
    this.state.set(snapshot);
    this.context.set(NO_COMPANY);
  }

  /** New company context from the server; the user stays. */
  setCompanyContext(context: CompanyContext): void {
    this.context.set(context);
  }

  setDefaultCompany(companyId: string): void {
    this.context.update((context) => ({ ...context, defaultCompanyId: companyId }));
  }

  /** Forgets who was connected (logout, expired session); the status is set by the caller. */
  clear(): void {
    this.state.set(null);
    this.context.set(NO_COMPANY);
  }

  setStatus(status: SessionStatus): void {
    this.statusState.set(status);
  }

  setActivity(activity: SessionActivity): void {
    this.activityState.set(activity);
  }

  setError(error: ApiError | null): void {
    this.errorState.set(error);
  }

  can(permission: string): boolean {
    return this.permissions().has(permission);
  }

  /** Whether the active company uses an optional functional domain. */
  uses(feature: string): boolean {
    const features = this.context().features;
    return !!this.activeCompany() && (features === null || features.includes(feature));
  }
}
