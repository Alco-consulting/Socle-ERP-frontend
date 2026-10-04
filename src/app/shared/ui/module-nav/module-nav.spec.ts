import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AlcoModuleNav, NavEntry } from './module-nav';

const ENTRIES: NavEntry[] = [
  { label: 'Tableau de bord', url: '/app/tableau-de-bord' },
  { label: 'Clients', url: '/app/clients' },
  { label: 'Fournisseurs', url: '/app/fournisseurs' },
  {
    label: 'Comptabilité',
    children: [
      { label: 'Écritures', url: '/app/ecritures' },
      { label: 'Lettrage', unavailable: 'Pas encore disponible : pas d’API.' },
    ],
  },
  {
    label: 'Analyse',
    children: [
      { label: 'Résultat', url: '/app/analyse/resultat', group: 'Rapports financiers' },
      { label: 'Balance générale', url: '/app/analyse/balance', group: 'Rapports comptables' },
      { label: 'Grand livre', url: '/app/analyse/grand-livre', group: 'Rapports comptables' },
    ],
  },
  {
    label: 'Configuration',
    children: [{ label: 'Comptes de trésorerie', url: '/app/tresorerie', group: 'Banques' }],
  },
];

@Component({
  imports: [AlcoModuleNav],
  template: `<alco-module-nav label="Navigation Test" [entries]="entries()" [keep]="keep()" />`,
})
class Host {
  readonly entries = signal(ENTRIES);
  readonly keep = signal<number | null>(4);
}

describe('AlcoModuleNav', () => {
  async function setup(keep: number | null = 4) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.keep.set(keep);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  const texts = (list: Element | null) =>
    Array.from(list?.querySelectorAll(':scope > li') ?? []).map((item) => item.textContent?.trim());

  /** Opens a menu by its trigger and reads its overlay (CDK, in the document). */
  async function open(fixture: { whenStable(): Promise<unknown> }, trigger: Element) {
    (trigger as HTMLButtonElement).click();
    await fixture.whenStable();
    const menu = document.querySelector('.menu') as HTMLElement;
    const groups = Array.from(menu.querySelectorAll('[role="group"]')).map((group) => ({
      title: document
        .getElementById(group.getAttribute('aria-labelledby') ?? '')
        ?.textContent?.trim(),
      items: Array.from(group.querySelectorAll('[role^="menuitem"]')).map((item) =>
        item.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    }));
    return { menu, groups };
  }

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((c) => c.remove()));

  it('wide screens: every entry, links then menus, in a labelled navigation', async () => {
    const { element } = await setup();
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Navigation Test');
    expect(texts(element.querySelector('.entries--full'))).toEqual(ENTRIES.map((e) => e.label));
    expect(element.querySelector('aside')).toBeNull();
  });

  it('a menu shows its links under titles, each group named by its title', async () => {
    const { fixture, element } = await setup();
    const analysis = Array.from(element.querySelectorAll('.entries--full button')).find((button) =>
      button.textContent?.includes('Analyse'),
    );
    const { groups } = await open(fixture, analysis!);
    expect(groups).toEqual([
      { title: 'Rapports financiers', items: ['Résultat'] },
      { title: 'Rapports comptables', items: ['Balance générale', 'Grand livre'] },
    ]);
  });

  it('an unavailable function is shown disabled with its reason, never as a screen', async () => {
    const { fixture, element } = await setup();
    const accounting = Array.from(element.querySelectorAll('.entries--full button')).find(
      (button) => button.textContent?.includes('Comptabilité'),
    );
    const { menu } = await open(fixture, accounting!);
    const lettering = Array.from(menu.querySelectorAll('[role^="menuitem"]')).find((item) =>
      item.textContent?.includes('Lettrage'),
    );
    expect(lettering?.getAttribute('aria-disabled')).toBe('true');
    expect(lettering?.textContent).toContain('Pas encore disponible');
  });

  it('tablets: the first entries, then one « Plus » with the rest under their titles', async () => {
    const { fixture, element } = await setup();
    expect(texts(element.querySelector('.entries--tablet'))).toEqual([
      'Tableau de bord',
      'Clients',
      'Fournisseurs',
      'Comptabilité',
      'Plus',
    ]);
    const more = Array.from(element.querySelectorAll('.entries--tablet button')).find((button) =>
      button.textContent?.includes('Plus'),
    );
    const { groups } = await open(fixture, more!);
    expect(groups.map((group) => group.title)).toEqual([
      'Analyse · Rapports financiers',
      'Analyse · Rapports comptables',
      'Configuration · Banques',
    ]);
  });

  it('short menus never collapse on tablets', async () => {
    const { element } = await setup(null);
    expect(element.querySelector('.entries--tablet')).toBeNull();
  });

  it('phones: one menu named after the navigation and the current screen, still grouped', async () => {
    const { fixture, element } = await setup();
    const trigger = element.querySelector('.compact button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('Navigation Test : Menu');
    const { menu, groups } = await open(fixture, trigger);
    expect(groups.map((group) => group.title)).toEqual([
      'Comptabilité',
      'Analyse · Rapports financiers',
      'Analyse · Rapports comptables',
      'Configuration · Banques',
    ]);
    // Direct links first, outside any group.
    expect(menu.querySelector('[role="none"]')?.textContent).toContain('Fournisseurs');
  });
});
