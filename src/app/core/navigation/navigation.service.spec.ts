import { TestBed } from '@angular/core/testing';

import { SessionStore } from '../session/session.store';
import { openTestSession } from '../session/testing';
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

function signIn(
  permissions: string[],
  features: string[] | null = ALL_FEATURES,
  globalPermissions: string[] = [],
): NavigationService {
  openTestSession(TestBed.inject(SessionStore), { permissions, features, globalPermissions });
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
      'Documents',
      'Tableau de bord',
      'Paramètres',
    ]);
    // Reporting is Comptabilité › Analyse, never an application of its own.
    for (const label of [...FINANCIAL_DOMAINS, 'Imports / Exports', 'Reporting']) {
      expect(APPLICATIONS.some((app) => app.label === label)).toBe(false);
    }
  });

  it('makes the financial domains sections of Comptabilité', () => {
    expect(labels(accounting().sections ?? [])).toEqual(FINANCIAL_DOMAINS);
  });

  it('gives Comptabilité three links and three grouped menus', () => {
    const nav = accounting().nav;
    expect(labels(nav)).toEqual([
      'Tableau de bord',
      'Clients',
      'Fournisseurs',
      'Comptabilité',
      'Analyse',
      'Configuration',
    ]);
    const groupsOf = (label: string) => [
      ...new Set(nav.find((entry) => entry.label === label)?.children?.map((link) => link.group)),
    ];
    expect(groupsOf('Analyse')).toEqual([
      'Rapports financiers',
      'Rapports comptables',
      'Rapports de tiers',
      'Analyses',
    ]);
    expect(groupsOf('Configuration')).toEqual([
      'Général',
      'Comptabilité',
      'Banques',
      'Paiements',
      'Taxes',
      'Immobilisations',
      'Analytique',
      'Emprunts',
    ]);
    expect(labels(nav.find((entry) => entry.label === 'Comptabilité')?.children ?? [])).toEqual([
      'Écritures',
      'Journaux',
      'Plan comptable',
      'Tiers',
      'Trésorerie',
      'Lettrage',
      'Rapprochement',
      'Clôture',
    ]);
  });

  it('never gives a screen to a function the API does not offer (lettrage)', () => {
    const lettering = accounting()
      .nav.flatMap((entry) => entry.children ?? [])
      .find((link) => link.label === 'Lettrage');
    expect(lettering?.unavailable).toContain('l’API ne propose pas le lettrage');
    expect(menuLinks(accounting().nav).map((link) => link.label)).not.toContain('Lettrage');
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

  it('every application and section needs a backend read permission', () => {
    for (const app of APPLICATIONS) {
      if (app.permission) {
        expect(app.permission).toMatch(/^[a-z_]+\.read$/);
      } else {
        // No permission of its own: each of its screens has one.
        for (const link of menuLinks(app.nav)) {
          expect(link.permission, `${app.label} › ${link.label}`).toMatch(/^[a-z_]+\.[a-z_]+$/);
        }
      }
    }
    for (const section of accounting().sections ?? []) {
      expect(section.permission).toMatch(/^[a-z_]+\.read$/);
    }
  });
});

describe('NavigationService', () => {
  it('shows only the applications the user may open', () => {
    const navigation = signIn(['accounting.read', 'reporting.read', 'dashboards.read']);
    expect(labels(navigation.applications())).toEqual(['Comptabilité', 'Tableau de bord']);
    expect(signIn([]).applications()).toEqual([]);
  });

  it('shows every financial domain inside Comptabilité to a full accountant', () => {
    const navigation = signIn([
      'accounting.read',
      'dashboards.read',
      'reporting.read',
      'reporting.read_auxiliary',
      'reporting.read_analytics',
      'reporting.read_financial_statements',
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
      'Clients',
      'Fournisseurs',
      'Comptabilité',
      'Analyse',
      'Configuration',
    ]);
    const urls = navigation
      .menu(accounting())
      .flatMap((entry) => (entry.children ?? [entry]).map((link) => link.url));
    for (const path of [
      'tresorerie/operations',
      'immobilisations/actifs',
      'emprunts/liste',
      'taxes/liste',
      'analytique/rapports',
      'audit/journal',
    ]) {
      expect(urls).toContain(`/app/comptabilite/${path}`);
    }
  });

  it('keeps the groups and shows an unavailable function disabled, without URL', () => {
    const navigation = signIn(['accounting.read', 'reporting.read_auxiliary']);
    const menu = navigation.menu(accounting());
    const analysis = menu.find((entry) => entry.label === 'Analyse');
    // Only the reports of the user's permission, under their title.
    expect(analysis?.children).toEqual([
      {
        label: 'Balance clients',
        group: 'Rapports de tiers',
        url: '/app/comptabilite/analyse/balance-clients',
      },
      {
        label: 'Balance fournisseurs',
        group: 'Rapports de tiers',
        url: '/app/comptabilite/analyse/balance-fournisseurs',
      },
    ]);
    const lettering = menu
      .find((entry) => entry.label === 'Comptabilité')
      ?.children?.find((link) => link.label === 'Lettrage');
    expect(lettering?.url).toBeUndefined();
    expect(lettering?.unavailable).toBeTruthy();
  });

  it('hides a menu whose screens are all closed, even with an unavailable function in it', () => {
    const navigation = signIn(['accounting.read']);
    expect(labels(navigation.menu(accounting()))).toEqual(['Comptabilité', 'Configuration']);
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
    expect(navigation.canOpenUrl('/app/comptabilite/ecritures')).toBe(true);
    expect(navigation.canOpenUrl('/app/comptabilite/immobilisations/actifs')).toBe(false); // feature
    expect(navigation.canOpenUrl('/app/comptabilite/tresorerie/operations')).toBe(false); // permission
    expect(navigation.canOpenUrl('/app/comptabilite/analyse/balance')).toBe(false); // link permission
    expect(navigation.canOpenUrl('/app/comptabilite/tableau-de-bord')).toBe(false); // dashboards.read
    expect(navigation.canOpenUrl('/app/tiers/liste')).toBe(false); // application
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
      '/app/comptabilite/tresorerie/comptes',
    );
    expect(
      navigation.sectionOfUrl(accounting(), '/app/comptabilite/tresorerie/operations?x=1')?.label,
    ).toBe('Trésorerie');
    expect(navigation.sectionOfUrl(accounting(), '/app/comptabilite/ecritures')).toBeUndefined();
  });

  it('sends a closed section to its first screen, so that the guard explains why', () => {
    const navigation = signIn(['accounting.read', 'loans.read'], ['treasury']);
    const loans = findSection(accounting(), 'emprunts')!;
    const target = navigation.sectionHomeUrl(accounting(), loans);
    expect(target).toBe('/app/comptabilite/emprunts/liste');
    expect(navigation.canOpenUrl(target)).toBe(false);
  });

  it('counts a global permission only when it is global on the server', () => {
    // A platform administrator: auth/me/ lists every permission; in a company where it has
    // no membership grant, the company gives nothing but the company management ones.
    const navigation = signIn(['companies.read'], null, ['accounting.read', 'users.read']);
    expect(labels(navigation.applications())).toEqual(['Paramètres']);
    expect(navigation.canOpenUrl('/app/comptabilite/ecritures')).toBe(false);
    expect(labels(navigation.menu(findApplication('settings')!))).toEqual([
      'Société',
      'Utilisateurs',
    ]);
  });

  it('opens Paramètres as soon as one of its screens is permitted', () => {
    expect(labels(signIn(['currencies.read']).applications())).toEqual(['Paramètres']);
    expect(
      signIn(['accounting.read'])
        .applications()
        .map((app) => app.id),
    ).not.toContain('settings');
    expect(signIn(['companies.manage_members']).canOpenUrl('/app/parametres/roles')).toBe(true);
    expect(signIn(['companies.manage_members']).canOpenUrl('/app/parametres/societe')).toBe(false);
  });

  describe('landing after a company change', () => {
    const accountant = ['accounting.read', 'treasury.read', 'assets.read', 'reporting.read'];

    it('stays on the same menu screen when it is still open', () => {
      const navigation = signIn(accountant);
      expect(navigation.landingUrl('/app/comptabilite/ecritures')).toBe(
        '/app/comptabilite/ecritures',
      );
      expect(navigation.landingUrl('/app/comptabilite/tresorerie/operations')).toBe(
        '/app/comptabilite/tresorerie/operations',
      );
      expect(navigation.landingUrl('/app/comptabilite/analyse/balance')).toBe(
        '/app/comptabilite/analyse/balance',
      );
    });

    it('never keeps a record nor the filters of the previous company', () => {
      const navigation = signIn(accountant);
      expect(navigation.landingUrl('/app/comptabilite/ecritures/proto-050')).toBe(
        '/app/comptabilite/ecritures',
      );
      expect(navigation.landingUrl('/app/comptabilite/ecritures?etat=draft&journal=ACH')).toBe(
        '/app/comptabilite/ecritures',
      );
      expect(navigation.landingUrl('/app/comptabilite/ecritures/import')).toBe(
        '/app/comptabilite/ecritures',
      );
    });

    it('a screen closed in the new company: the home of the application', () => {
      const navigation = signIn(['accounting.read', 'treasury.read']);
      expect(navigation.landingUrl('/app/comptabilite/immobilisations/actifs')).toBe(
        '/app/comptabilite/ecritures',
      );
      expect(navigation.landingUrl('/app/comptabilite/analyse/balance')).toBe(
        '/app/comptabilite/ecritures',
      );
    });

    it('an application closed in the new company, or the launcher: the launcher', () => {
      const navigation = signIn(['accounting.read']);
      expect(navigation.landingUrl('/app/tiers/liste')).toBe('/app');
      expect(navigation.landingUrl('/app')).toBe('/app');
    });
  });

  it('starts an application on its first screen the user may open', () => {
    const navigation = signIn(['accounting.read', 'partners.read']);
    // The dashboard needs dashboards.read: without it, Clients comes first.
    expect(navigation.homeUrl(accounting())).toBe('/app/comptabilite/clients');
    expect(navigation.menu(accounting())[0]).toEqual({
      label: 'Clients',
      url: '/app/comptabilite/clients',
    });
    expect(signIn(['accounting.read', 'dashboards.read']).homeUrl(accounting())).toBe(
      '/app/comptabilite/tableau-de-bord',
    );
  });
});
