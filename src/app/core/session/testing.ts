import { CompanySummary, SessionStore } from './session.store';

/** Test helper: an open session in one company (or several), without any HTTP call. */

export const TEST_COMPANY: CompanySummary = {
  id: 'c1',
  name: 'Société test',
  legalName: 'Société test SARL',
  country: 'GN',
  currency: 'GNF',
  active: true,
};

export interface TestSession {
  /** Permissions in the active company. */
  readonly permissions?: readonly string[];
  /** Permissions from `auth/me/` (only the global ones count, as on the server). */
  readonly globalPermissions?: readonly string[];
  readonly features?: readonly string[] | null;
  readonly companies?: readonly CompanySummary[];
  /** Default: the first company; `null`: none chosen yet. */
  readonly activeCompanyId?: string | null;
  readonly displayName?: string;
}

export function openTestSession(store: SessionStore, session: TestSession = {}): void {
  const companies = session.companies ?? [TEST_COMPANY];
  store.load({
    user: { displayName: session.displayName ?? 'Test Utilisateur', email: 'test@example.org' },
    globalPermissions: session.globalPermissions ?? [],
  });
  store.setCompanyContext({
    companies,
    defaultCompanyId: companies[0]?.id ?? null,
    activeCompanyId:
      session.activeCompanyId === undefined ? (companies[0]?.id ?? null) : session.activeCompanyId,
    permissions: session.permissions ?? [],
    features: session.features ?? null,
  });
  store.setStatus('authenticated');
}
