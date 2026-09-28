import { Injectable, inject, provideAppInitializer, signal } from '@angular/core';

import { NotificationCenter } from '../../core/notifications/notification-center';
import { CompanySummary, SessionStore } from '../../core/session/session.store';

/**
 * PROTOTYPE — simulated user, companies and permissions (backend permission codes), so that
 * the launcher and the screens can be reviewed per profile. Replaced in Module F2 by the
 * API (`auth/me`, `company-context/`). No credential, no network call.
 */
export type PrototypeProfile = 'admin' | 'accountant' | 'viewer';

/** The simulated profile survives a reload of the tab (review convenience only). */
const PROFILE_KEY = 'alco.prototype.profile';

function storedProfile(): PrototypeProfile {
  try {
    const value = sessionStorage.getItem(PROFILE_KEY);
    return value === 'admin' || value === 'viewer' ? value : 'accountant';
  } catch {
    return 'accountant';
  }
}

const READ_ALL = [
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

export const PROTOTYPE_PROFILES: Readonly<
  Record<PrototypeProfile, { label: string; permissions: readonly string[] }>
> = {
  admin: {
    label: 'Administrateur',
    permissions: [...READ_ALL, 'users.read', 'accounting.create', 'accounting.validate'],
  },
  accountant: {
    label: 'Comptable',
    permissions: [...READ_ALL, 'accounting.create', 'accounting.validate'],
  },
  viewer: {
    label: 'Consultation',
    permissions: [
      'accounting.read',
      'reporting.read',
      'partners.read',
      'documents.read',
      'dashboards.read',
    ],
  },
};

function companies(permissions: readonly string[]): CompanySummary[] {
  return [
    {
      id: 'demo-gn',
      name: 'ALCO DÉMO SARL',
      fiscalYearLabel: 'Exercice 2026',
      currency: 'GNF',
      permissions,
    },
    {
      id: 'demo-sn',
      name: 'FILIALE DÉMO SA',
      fiscalYearLabel: 'Exercice 2026',
      currency: 'XOF',
      permissions,
    },
  ];
}

@Injectable({ providedIn: 'root' })
export class PrototypeSession {
  private readonly session = inject(SessionStore);
  private readonly notifications = inject(NotificationCenter);

  readonly profile = signal<PrototypeProfile>('accountant');

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
    try {
      sessionStorage.setItem(PROFILE_KEY, profile);
    } catch {
      // Storage unavailable (private mode): the profile simply resets on reload.
    }
    const current = this.session.activeCompany()?.id ?? 'demo-gn';
    this.session.load({
      user: { displayName: 'Aïssatou Démo', email: 'utilisateur.demo@alco.example' },
      companies: companies(PROTOTYPE_PROFILES[profile].permissions),
      activeCompanyId: current,
    });
  }
}

/** Seeds the session with the prototype profile at startup. */
export function providePrototypeSession() {
  return provideAppInitializer(() => inject(PrototypeSession).start());
}
