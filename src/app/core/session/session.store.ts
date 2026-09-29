import { Injectable, computed, signal } from '@angular/core';

export interface SessionUser {
  readonly displayName: string;
  readonly email: string;
}

export interface CompanySummary {
  /** `public_id` of the company: the value of `X-Company-ID`. */
  readonly id: string;
  readonly name: string;
  /** « Exercice 2026 » — shown next to the company in the top bar; empty when unknown. */
  readonly fiscalYearLabel: string;
  readonly currency: string;
  /**
   * Permissions of the user in this company (backend codes, e.g. `accounting.read`). The API
   * returns them for the current company only: other companies get theirs when selected.
   */
  readonly permissions: readonly string[];
  /**
   * Optional functional domains the company uses (`treasury`, `assets`, `loans`, `taxes`,
   * `analytics`): a services company without fixed assets never sees « Immobilisations ».
   * `null` = not configured, nothing hidden (the backend has no such setting yet; the
   * prototype simulates it).
   */
  readonly features: readonly string[] | null;
}

export interface SessionSnapshot {
  readonly user: SessionUser;
  /** Permissions granted outside any company (`users.read`…), from `auth/me/`. */
  readonly globalPermissions?: readonly string[];
  readonly companies: readonly CompanySummary[];
  readonly activeCompanyId: string;
}

/**
 * Who is connected, in which company, with which permissions. UX only: hiding what the
 * user cannot do. The backend remains the authority on every request.
 * Filled by `SessionService` (API mode) or by the prototype (simulated session).
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly state = signal<SessionSnapshot | null>(null);

  readonly user = computed(() => this.state()?.user ?? null);
  readonly companies = computed(() => this.state()?.companies ?? []);
  readonly activeCompany = computed(() => {
    const state = this.state();
    return state?.companies.find((company) => company.id === state.activeCompanyId) ?? null;
  });
  readonly permissions = computed(
    () =>
      new Set([
        ...(this.state()?.globalPermissions ?? []),
        ...(this.activeCompany()?.permissions ?? []),
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

  load(snapshot: SessionSnapshot): void {
    this.state.set(snapshot);
  }

  /** New company context from the server; the user stays. */
  setCompanies(companies: readonly CompanySummary[], activeCompanyId: string): void {
    this.state.update((state) => (state ? { ...state, companies, activeCompanyId } : state));
  }

  /** Forgets everything (logout, expired session). */
  clear(): void {
    this.state.set(null);
  }

  switchCompany(companyId: string): void {
    this.state.update((state) =>
      state && state.companies.some((company) => company.id === companyId)
        ? { ...state, activeCompanyId: companyId }
        : state,
    );
  }

  can(permission: string): boolean {
    return this.permissions().has(permission);
  }

  /** Whether the active company uses an optional functional domain. */
  uses(feature: string): boolean {
    const company = this.activeCompany();
    return !!company && (company.features === null || company.features.includes(feature));
  }
}
