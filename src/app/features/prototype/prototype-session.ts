import { Injectable, effect, inject, provideAppInitializer, signal } from '@angular/core';

import { NotificationCenter } from '../../core/notifications/notification-center';
import { CompanySummary, SessionStore } from '../../core/session/session.store';

/**
 * PROTOTYPE — simulated user, companies and permissions (backend permission codes), so that
 * the launcher and the screens can be reviewed per profile. Replaced in Module F2 by the
 * API (`auth/me`, `company-context/`). No credential, no network call.
 */
export type PrototypeProfile = 'admin' | 'accountant' | 'viewer';

/** Profile and company survive a reload of the tab (review convenience only). */
const PROFILE_KEY = 'alco.prototype.profile';
const COMPANY_KEY = 'alco.prototype.company';

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): the choice simply resets on reload.
  }
}

function storedProfile(): PrototypeProfile {
  const value = read(PROFILE_KEY);
  return value === 'admin' || value === 'viewer' ? value : 'accountant';
}

/** Everything an accountant reads, domain by domain (backend permission codes). */
const ACCOUNTANT_READ = [
  'accounting.read',
  'treasury.read',
  'partners.read',
  'assets.read',
  'loans.read',
  'taxes.read',
  'analytics.read',
  'reporting.read',
  'closing.read',
  'audit.read',
  'imports_exports.read',
  'documents.read',
  'dashboards.read',
];

const ACCOUNTANT_WRITE = [
  'accounting.create',
  'accounting.validate',
  'partners.create',
  'imports_exports.create',
  'imports_exports.export',
];

export const PROTOTYPE_PROFILES: Readonly<
  Record<PrototypeProfile, { label: string; permissions: readonly string[] }>
> = {
  // Launcher: Comptabilité, Tiers, Reporting, Documents, Tableau de bord, Paramètres.
  admin: {
    label: 'Administrateur',
    permissions: [...ACCOUNTANT_READ, ...ACCOUNTANT_WRITE, 'users.read'],
  },
  // Launcher: Comptabilité, Tiers, Reporting, Documents, Tableau de bord.
  accountant: {
    label: 'Comptable',
    permissions: [...ACCOUNTANT_READ, ...ACCOUNTANT_WRITE],
  },
  // Launcher: Comptabilité, Reporting, Tableau de bord. In Comptabilité: no Tiers,
  // Immobilisations, Emprunts, Analytique, Audit or Clôture; no creation, no import/export.
  viewer: {
    label: 'Consultation',
    permissions: [
      'accounting.read',
      'treasury.read',
      'taxes.read',
      'reporting.read',
      'dashboards.read',
    ],
  },
};

function companies(permissions: readonly string[]): CompanySummary[] {
  return [
    {
      // Uses every financial domain.
      id: 'demo-gn',
      name: 'ALCO DÉMO SARL',
      fiscalYearLabel: 'Exercice 2026',
      currency: 'GNF',
      permissions,
      features: ['treasury', 'assets', 'loans', 'taxes', 'analytics'],
    },
    {
      // Services company: no fixed assets, no loans, no cost accounting.
      id: 'demo-sn',
      name: 'FILIALE SERVICES DÉMO SA',
      fiscalYearLabel: 'Exercice 2026',
      currency: 'XOF',
      permissions,
      features: ['treasury', 'taxes'],
    },
  ];
}

@Injectable({ providedIn: 'root' })
export class PrototypeSession {
  private readonly session = inject(SessionStore);
  private readonly notifications = inject(NotificationCenter);

  readonly profile = signal<PrototypeProfile>('accountant');

  constructor() {
    effect(() => {
      const company = this.session.activeCompany();
      if (company) {
        write(COMPANY_KEY, company.id);
      }
    });
  }

  start(): void {
    this.applyProfile(storedProfile());
    this.notifications.load([
      {
        id: 'n1',
        title: 'Écriture à valider',
        detail: 'EC-2026-000132 soumise par un collègue (démo)',
        url: '/comptabilite/ecritures?etat=submitted',
        read: false,
      },
      {
        id: 'n2',
        title: 'Période d’août clôturée',
        detail: 'Les écritures d’août sont verrouillées (démo)',
        read: false,
      },
    ]);
  }

  applyProfile(profile: PrototypeProfile): void {
    this.profile.set(profile);
    write(PROFILE_KEY, profile);
    const list = companies(PROTOTYPE_PROFILES[profile].permissions);
    const wanted = this.session.activeCompany()?.id ?? read(COMPANY_KEY);
    this.session.load({
      user: { displayName: 'Aïssatou Démo', email: 'utilisateur.demo@alco.example' },
      companies: list,
      activeCompanyId: list.some((company) => company.id === wanted) ? (wanted ?? '') : list[0].id,
    });
  }
}

/** Seeds the session with the prototype profile at startup. */
export function providePrototypeSession() {
  return provideAppInitializer(() => inject(PrototypeSession).start());
}
