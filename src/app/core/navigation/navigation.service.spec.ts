import { TestBed } from '@angular/core/testing';

import { SessionStore } from '../session/session.store';
import { APPLICATIONS, findApplication } from './applications';
import { NavigationService } from './navigation.service';

function signIn(permissions: string[]): NavigationService {
  TestBed.inject(SessionStore).load({
    user: { displayName: 'Test Utilisateur', email: 'test@example.org' },
    companies: [
      {
        id: 'c1',
        name: 'Société test',
        fiscalYearLabel: 'Exercice 2026',
        currency: 'GNF',
        permissions,
      },
    ],
    activeCompanyId: 'c1',
  });
  return TestBed.inject(NavigationService);
}

describe('NavigationService', () => {
  it('shows only the applications the user may open', () => {
    const navigation = signIn(['accounting.read', 'treasury.read']);
    expect(navigation.applications().map((app) => app.id)).toEqual(['accounting', 'treasury']);
  });

  it('shows nothing without permission', () => {
    expect(signIn([]).applications()).toEqual([]);
  });

  it('every application declares a backend read permission and a first screen', () => {
    for (const app of APPLICATIONS) {
      expect(app.permission).toMatch(/^[a-z_]+\.read$/);
      expect(app.nav.length).toBeGreaterThan(0);
    }
  });

  it('keeps module menus short (at most 7 top-level entries)', () => {
    for (const app of APPLICATIONS) {
      expect(app.nav.length).toBeLessThanOrEqual(7);
    }
  });

  it('removes menu entries whose permission is missing', () => {
    const accounting = findApplication('accounting');
    expect(accounting).toBeDefined();
    const navigation = signIn(['accounting.read']);
    const menu = navigation.menu(accounting!);
    const labels = menu.map((entry) => entry.label);
    expect(labels).not.toContain('Rapports');
    const more = menu.find((entry) => entry.label === 'Plus');
    expect(more?.children?.map((child) => child.label)).toEqual(['Lettrage']);
  });

  it('builds absolute URLs from the application path', () => {
    const accounting = findApplication('accounting')!;
    const navigation = signIn(['accounting.read', 'reporting.read']);
    expect(navigation.homeUrl(accounting)).toBe('/comptabilite/tableau-de-bord');
    expect(navigation.menu(accounting)[1]).toEqual({
      label: 'Écritures',
      url: '/comptabilite/ecritures',
    });
  });
});
