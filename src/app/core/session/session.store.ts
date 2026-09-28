import { Injectable, computed, signal } from '@angular/core';

export interface SessionUser {
  readonly displayName: string;
  readonly email: string;
}

export interface CompanySummary {
  readonly id: string;
  readonly name: string;
  /** « Exercice 2026 » — shown next to the company in the top bar. */
  readonly fiscalYearLabel: string;
  readonly currency: string;
  /** Permissions of the user in this company (backend codes, e.g. `accounting.read`). */
  readonly permissions: readonly string[];
}

export interface SessionSnapshot {
  readonly user: SessionUser;
  readonly companies: readonly CompanySummary[];
  readonly activeCompanyId: string;
}

/**
 * Who is connected, in which company, with which permissions. UX only: hiding what the
 * user cannot do. The backend remains the authority on every request.
 * Filled by the prototype today; by `auth/me` and `company-context/` in Module F2.
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
  readonly permissions = computed(() => new Set(this.activeCompany()?.permissions ?? []));
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
}
