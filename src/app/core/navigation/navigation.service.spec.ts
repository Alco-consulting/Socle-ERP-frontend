import { TestBed } from '@angular/core/testing';

import { SessionStore } from '../session/session.store';
import { APPLICATIONS, findApplication, findSection, menuLinks } from './applications';
import { NavigationService } from './navigation.service';

const ALL_FEATURES = ['treasury', 'assets', 'loans', 'taxes', 'analytics'];
const FINANCIAL_DOMAINS = [
  'Trésorerie',
  'Immobilisations',
  'Emprunts',
  'Taxes',
  'Analytique',
  'Audit',
];

function signIn(permissions: string[], features: string[] = ALL_FEATURES): NavigationService {
  TestBed.inject(SessionStore).load({
    user: { displayName: 'Test Utilisateur', email: 'test@example.org' },
    companies: [
      {
        id: 'c1',
        name: 'Société test',
        fiscalYearLabel: 'Exercice 2026',
        currency: 'GNF',
        permissions,
        features,
      },
    ],
    activeCompanyId: 'c1',
  });
  return TestBed.inject(NavigationService);
}

const accounting = () => findApplication('accounting')!;
const labels = (entries: readonly { label: string }[]) => entries.map((entry) => entry.label);
const flatLabels = (navigation: NavigationService) =>
  navigation
    .menu(accounting())
    .flatMap((entry) => (entry.children ? labels(entry.children) : [entry.label]));

describe('Application catalogue', () => {
  it('offers a few broad applications, never the financial domains nor Import / Export', () => {
    expect(APPLICATIONS.map((app) => app.label)).toEqual([
      'Comptabilité',
      'Tiers',
      'Reporting',
      'Documents',
      'Tableau de bord',
      'Paramètres',
    ]);
    for (const label of [...FINANCIAL_DOMAINS, 'Imports / Exports']) {
      expect(APPLICATIONS.some((app) => app.label === label)).toBe(false);
    }
  });

  it('makes the financial domains sections of Comptabilité', () => {
    expect(labels(accounting().sections ?? [])).toEqual(['Tiers', ...FINANCIAL_DOMAINS]);
  });

  it('never offers import / export as a menu entry: it is a contextual action', () => {
    const everyLabel = APPLICATIONS.flatMap((app) => [
      ...menuLinks(app.nav).map((link) => link.label),
      ...(app.sections ?? []).flatMap((section) =>
        menuLinks(section.nav).map((link) => link.label),
      ),
    ]);
    expect(everyLabel.filter((label) => /import|export/i.test(label))).toEqual([]);
  });

  it('keeps menus short: 6 direct links at most, then 3 menus at most', () => {
    const menus = [
      ...APPLICATIONS.map((app) => app.nav),
      ...(accounting().sections ?? []).map((s) => s.nav),
    ];
    for (const nav of menus) {
      expect(nav.filter((entry) => !entry.children).length).toBeLessThanOrEqual(6);
      expect(nav.filter((entry) => entry.children).length).toBeLessThanOrEqual(3);
    }
  });

  it('every application and section declares a backend read permission', () => {
    for (const app of APPLICATIONS) {
      expect(app.permission).toMatch(/^[a-z_]+\.read$/);
    }
    for (const section of accounting().sections ?? []) {
      expect(section.permission).toMatch(/^[a-z_]+\.read$/);
    }
  });
});

describe('NavigationService', () => {
  it('shows only the applications the user may open', () => {
    const navigation = signIn(['accounting.read', 'reporting.read', 'dashboards.read']);
    expect(labels(navigation.applications())).toEqual([
      'Comptabilité',
      'Reporting',
      'Tableau de bord',
    ]);
    expect(signIn([]).applications()).toEqual([]);
  });

  it('shows every financial domain inside Comptabilité to a full accountant', () => {
    const navigation = signIn([
      'accounting.read',
      'reporting.read',
      'closing.read',
      'partners.read',
      'treasury.read',
      'assets.read',
      'loans.read',
      'taxes.read',
      'analytics.read',
      'audit.read',
    ]);
    expect(labels(navigation.menu(accounting()))).toEqual([
      'Tableau de bord',
      'Écritures',
      'Journaux',
      'Plan comptable',
      'Tiers',
      'Trésorerie',
      'Rapports',
      'Configuration',
      'Plus',
    ]);
    expect(flatLabels(navigation)).toEqual(expect.arrayContaining(FINANCIAL_DOMAINS));
  });

  it('hides the domains the user may not read', () => {
    const navigation = signIn(['accounting.read', 'treasury.read', 'taxes.read']);
    const visible = flatLabels(navigation);
    expect(visible).toContain('Trésorerie');
    expect(visible).toContain('Taxes');
    for (const hidden of [
      'Tiers',
      'Immobilisations',
      'Emprunts',
      'Analytique',
      'Audit',
      'Clôture',
      'Balance générale',
    ]) {
      expect(visible).not.toContain(hidden);
    }
  });

  it('hides the domains the company does not use, even with the permission', () => {
    const navigation = signIn(
      [
        'accounting.read',
        'treasury.read',
        'assets.read',
        'loans.read',
        'analytics.read',
        'taxes.read',
      ],
      ['treasury', 'taxes'],
    );
    const visible = flatLabels(navigation);
    expect(visible).toEqual(expect.arrayContaining(['Trésorerie', 'Taxes']));
    for (const hidden of ['Immobilisations', 'Emprunts', 'Analytique']) {
      expect(visible).not.toContain(hidden);
    }
  });

  it('closes the URL of a hidden screen as well (used by the route guard)', () => {
    const navigation = signIn(['accounting.read', 'assets.read'], ['treasury']);
    expect(navigation.canOpenUrl('/comptabilite/ecritures')).toBe(true);
    expect(navigation.canOpenUrl('/comptabilite/immobilisations/actifs')).toBe(false); // feature
    expect(navigation.canOpenUrl('/comptabilite/tresorerie/operations')).toBe(false); // permission
    expect(navigation.canOpenUrl('/comptabilite/rapports/balance')).toBe(false); // group permission
    expect(navigation.canOpenUrl('/tiers/liste')).toBe(false); // application
  });

  it('builds the menu of a section and its first screen', () => {
    const navigation = signIn(['accounting.read', 'treasury.read']);
    const treasury = findSection(accounting(), 'tresorerie')!;
    expect(labels(navigation.sectionMenu(accounting(), treasury))).toEqual([
      'Comptes de trésorerie',
      'Opérations',
      'Virements',
      'Relevés',
      'Rapprochements',
      'Plus',
    ]);
    expect(navigation.sectionHomeUrl(accounting(), treasury)).toBe(
      '/comptabilite/tresorerie/comptes',
    );
    expect(
      navigation.sectionOfUrl(accounting(), '/comptabilite/tresorerie/operations?x=1')?.label,
    ).toBe('Trésorerie');
    expect(navigation.sectionOfUrl(accounting(), '/comptabilite/ecritures')).toBeUndefined();
  });

  it('sends a closed section to its first screen, so that the guard explains why', () => {
    const navigation = signIn(['accounting.read', 'loans.read'], ['treasury']);
    const loans = findSection(accounting(), 'emprunts')!;
    const target = navigation.sectionHomeUrl(accounting(), loans);
    expect(target).toBe('/comptabilite/emprunts/liste');
    expect(navigation.canOpenUrl(target)).toBe(false);
  });

  it('starts an application on its first screen the user may open', () => {
    const navigation = signIn(['accounting.read', 'partners.read']);
    expect(navigation.homeUrl(accounting())).toBe('/comptabilite/tableau-de-bord');
    expect(navigation.menu(accounting())[1]).toEqual({
      label: 'Écritures',
      url: '/comptabilite/ecritures',
    });
  });
});
