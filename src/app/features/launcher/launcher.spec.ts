import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { APPLICATIONS, AlcoApplication } from '../../core/navigation/applications';
import { NavigationService } from '../../core/navigation/navigation.service';
import { SessionStore } from '../../core/session/session.store';
import { AlcoLauncher } from './launcher';

const ADMIN = [
  'accounting.read',
  'partners.read',
  'reporting.read',
  'documents.read',
  'dashboards.read',
  'users.read',
  'treasury.read',
  'assets.read',
  'loans.read',
  'taxes.read',
  'analytics.read',
  'audit.read',
  'imports_exports.read',
];

const REMOVED_TILES = [
  'Trésorerie',
  'Immobilisations',
  'Emprunts',
  'Taxes',
  'Analytique',
  'Audit',
  'Imports / Exports',
];

describe('AlcoLauncher', () => {
  async function render(permissions: string[], applications?: readonly AlcoApplication[]) {
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
    TestBed.inject(SessionStore).load({
      user: { displayName: 'Aïssatou Démo', email: 'demo@example.org' },
      companies: [
        {
          id: 'c1',
          name: 'ALCO DÉMO SARL',
          fiscalYearLabel: 'Exercice 2026',
          currency: 'GNF',
          permissions,
          features: ['treasury', 'assets', 'loans', 'taxes', 'analytics'],
        },
      ],
      activeCompanyId: 'c1',
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
    const { tiles } = await render(ADMIN);
    expect(tiles()).toEqual([
      'Comptabilité',
      'Tiers',
      'Reporting',
      'Documents',
      'Tableau de bord',
      'Paramètres',
    ]);
  });

  it('never shows a financial domain nor Import / Export as a tile', async () => {
    const { tiles } = await render(ADMIN);
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
    expect(tiles()).toEqual(['Comptabilité', 'Reporting', 'Tableau de bord']);
    const link = element.querySelector('a.tile') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/comptabilite/tableau-de-bord');
  });

  it('says on the Comptabilité tile that the financial domains live there', async () => {
    const { element } = await render(['accounting.read']);
    expect(element.querySelector('.tile-description')?.textContent).toContain('trésorerie');
  });

  it('states the active company and the number of applications', async () => {
    const { element } = await render(['accounting.read', 'partners.read']);
    expect(element.textContent).toContain(
      'ALCO DÉMO SARL · Exercice 2026 · 2 applications disponibles',
    );
  });

  it('offers no search box for a handful of applications', async () => {
    expect((await render(ADMIN)).element.querySelector('input[type=search]')).toBeNull();
  });

  describe('with many applications (future growth)', () => {
    const many: AlcoApplication[] = [
      ...APPLICATIONS,
      ...['Stocks', 'Paie', 'Achats'].map((label) => ({
        ...APPLICATIONS[3],
        id: label,
        label,
        path: label.toLowerCase(),
        keywords: [],
      })),
    ];

    it('finds an application by a word of its domains, ignoring accents', async () => {
      const { tiles, search } = await render(ADMIN, many);
      await search('tresorerie');
      expect(tiles()).toEqual(['Comptabilité']);
      await search('tva');
      expect(tiles()).toEqual(['Comptabilité']);
    });

    it('explains an empty result instead of showing nothing', async () => {
      const { element, search } = await render(ADMIN, many);
      await search('zzz');
      expect(element.textContent).toContain('Aucune application ne correspond à « zzz ».');
    });
  });

  it('explains when the company gives access to no application', async () => {
    const { element, tiles } = await render([]);
    expect(tiles()).toEqual([]);
    expect(element.textContent).toContain('Aucune application disponible dans cette société.');
  });
});
