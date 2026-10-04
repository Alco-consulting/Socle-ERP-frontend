import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { APPLICATIONS, AlcoApplication } from '../../core/navigation/applications';
import { NavigationService } from '../../core/navigation/navigation.service';
import { SessionStore } from '../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../core/session/testing';
import { AlcoLauncher } from './launcher';

/** Everything readable in a company; `users.read` is global (`auth/me/`), see ADMIN_GLOBAL. */
const ADMIN = [
  'accounting.read',
  'partners.read',
  'reporting.read',
  'documents.read',
  'dashboards.read',
  'treasury.read',
  'assets.read',
  'loans.read',
  'taxes.read',
  'analytics.read',
  'audit.read',
  'imports_exports.read',
];
const ADMIN_GLOBAL = ['users.read'];

const REMOVED_TILES = [
  'Trésorerie',
  'Immobilisations',
  'Emprunts',
  'Taxes',
  'Analytique',
  'Audit',
  'Imports / Exports',
  'Reporting',
];

describe('AlcoLauncher', () => {
  async function render(
    permissions: string[],
    options: {
      applications?: readonly AlcoApplication[];
      globalPermissions?: string[];
      companies?: number;
    } = {},
  ) {
    const applications = options.applications;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ...(applications
          ? [
              {
                provide: NavigationService,
                useValue: {
                  applications: signal(applications),
                  homeUrl: (app: AlcoApplication) => `/${app.path}`,
                },
              },
            ]
          : []),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), {
      displayName: 'Mariam Test',
      permissions,
      globalPermissions: options.globalPermissions,
      companies: Array.from({ length: options.companies ?? 1 }, (_, index) => ({
        ...TEST_COMPANY,
        id: `c${index + 1}`,
        name: index === 0 ? 'ALCO GUINÉE' : `Société ${index + 1}`,
      })),
    });
    const fixture = TestBed.createComponent(AlcoLauncher);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const tiles = () =>
      Array.from(element.querySelectorAll('.tile-label')).map((tile) => tile.textContent?.trim());
    const search = async (text: string) => {
      const input = element.querySelector('input[type=search]') as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    return { fixture, element, tiles, search };
  }

  it('shows a few broad applications, even with every permission', async () => {
    const { tiles } = await render(ADMIN, { globalPermissions: ADMIN_GLOBAL });
    expect(tiles()).toEqual([
      'Comptabilité',
      'Tiers',
      'Documents',
      'Tableau de bord',
      'Paramètres',
    ]);
  });

  it('never shows a financial domain nor Import / Export as a tile', async () => {
    const { tiles } = await render(ADMIN, { globalPermissions: ADMIN_GLOBAL });
    for (const label of REMOVED_TILES) {
      expect(tiles()).not.toContain(label);
    }
  });

  it('shows one tile per permitted application, linking to its first screen', async () => {
    const { element, tiles } = await render([
      'accounting.read',
      'reporting.read',
      'dashboards.read',
    ]);
    // Reporting is Comptabilité › Analyse: reporting.read opens no tile of its own.
    expect(tiles()).toEqual(['Comptabilité', 'Tableau de bord']);
    const link = element.querySelector('a.tile') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/comptabilite/tableau-de-bord');
  });

  it('says on the Comptabilité tile that the financial domains live there', async () => {
    const { element } = await render(['accounting.read']);
    expect(element.querySelector('.tile-description')?.textContent).toContain('trésorerie');
  });

  it('states the active company and the number of applications', async () => {
    const { element } = await render(['accounting.read', 'partners.read']);
    expect(element.textContent).toContain('ALCO GUINÉE · 2 applications disponibles');
  });

  it('a global grant of a company domain never opens it (platform administrator)', async () => {
    // auth/me/ of a superuser lists every permission; only users.* and companies.create
    // hold outside a company (backend rule): the company gave none here.
    const { tiles } = await render([], {
      globalPermissions: ['accounting.read', 'treasury.read', 'dashboards.read', 'users.read'],
    });
    expect(tiles()).toEqual(['Paramètres']);
  });

  it('Paramètres opens for a company administrator without the global users.read', async () => {
    const { tiles } = await render(['companies.read', 'companies.manage_members']);
    expect(tiles()).toEqual(['Paramètres']);
  });

  it('offers no search box for a handful of applications', async () => {
    expect((await render(ADMIN)).element.querySelector('input[type=search]')).toBeNull();
  });

  describe('with many applications (future growth)', () => {
    const many: AlcoApplication[] = [
      ...APPLICATIONS,
      ...['Stocks', 'Paie', 'Achats', 'Ventes'].map((label) => ({
        ...APPLICATIONS[2],
        id: label,
        label,
        path: label.toLowerCase(),
        keywords: [],
      })),
    ];

    it('finds an application by a word of its domains, ignoring accents', async () => {
      const { tiles, search } = await render(ADMIN, { applications: many });
      await search('tresorerie');
      expect(tiles()).toEqual(['Comptabilité']);
      await search('tva');
      expect(tiles()).toEqual(['Comptabilité']);
    });

    it('explains an empty result instead of showing nothing', async () => {
      const { element, search } = await render(ADMIN, { applications: many });
      await search('zzz');
      expect(element.textContent).toContain('Aucune application ne correspond à « zzz ».');
    });
  });

  it('explains when the company gives access to no application', async () => {
    const { element, tiles } = await render([]);
    expect(tiles()).toEqual([]);
    expect(element.textContent).toContain('Aucune application disponible dans cette société.');
    expect(element.textContent).not.toContain('choisissez une autre société');
  });

  it('suggests another company only when there is one', async () => {
    const { element } = await render([], { companies: 2 });
    expect(element.textContent).toContain('choisissez une autre société en haut à droite');
  });
});
