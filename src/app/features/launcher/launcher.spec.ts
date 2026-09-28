import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SessionStore } from '../../core/session/session.store';
import { AlcoLauncher } from './launcher';

const ALL = [
  'accounting.read',
  'treasury.read',
  'partners.read',
  'assets.read',
  'loans.read',
  'taxes.read',
  'analytics.read',
  'reporting.read',
  'audit.read',
];

describe('AlcoLauncher', () => {
  async function render(permissions: string[]) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(SessionStore).load({
      user: { displayName: 'Aïssatou Démo', email: 'demo@example.org' },
      companies: [
        {
          id: 'c1',
          name: 'ALCO DÉMO SARL',
          fiscalYearLabel: 'Exercice 2026',
          currency: 'GNF',
          permissions,
        },
      ],
      activeCompanyId: 'c1',
    });
    const fixture = TestBed.createComponent(AlcoLauncher);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const tiles = () =>
      Array.from(element.querySelectorAll('.tile-label')).map((tile) => tile.textContent?.trim());
    return { fixture, element, tiles };
  }

  it('shows one tile per permitted application, linking to its first screen', async () => {
    const { element, tiles } = await render(['accounting.read', 'partners.read']);
    expect(tiles()).toEqual(['Comptabilité', 'Tiers']);
    const link = element.querySelector('a.tile') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/comptabilite/tableau-de-bord');
  });

  it('states the active company and the number of applications', async () => {
    const { element } = await render(['accounting.read', 'partners.read']);
    expect(element.textContent).toContain(
      'ALCO DÉMO SARL · Exercice 2026 · 2 applications disponibles',
    );
  });

  it('offers a search only when there are many applications', async () => {
    expect(
      (await render(['accounting.read'])).element.querySelector('input[type=search]'),
    ).toBeNull();
  });

  it('search ignores accents and matches keywords', async () => {
    const { fixture, element, tiles } = await render(ALL);
    const input = element.querySelector('input[type=search]') as HTMLInputElement;
    input.value = 'tresorerie';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(tiles()).toEqual(['Trésorerie']);
    input.value = 'tva';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(tiles()).toEqual(['Taxes']);
  });

  it('explains an empty result instead of showing nothing', async () => {
    const { fixture, element } = await render(ALL);
    const input = element.querySelector('input[type=search]') as HTMLInputElement;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(element.textContent).toContain('Aucune application ne correspond à « zzz ».');
  });

  it('explains when the company gives access to no application', async () => {
    const { element, tiles } = await render([]);
    expect(tiles()).toEqual([]);
    expect(element.textContent).toContain('Aucune application disponible dans cette société.');
  });
});
