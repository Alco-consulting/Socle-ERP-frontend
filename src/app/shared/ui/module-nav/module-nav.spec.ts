import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AlcoModuleNav, NavEntry } from './module-nav';

const ENTRIES: NavEntry[] = [
  { label: 'Tableau de bord', url: '/app/tableau-de-bord' },
  { label: 'Écritures', url: '/app/ecritures' },
  { label: 'Journaux', url: '/app/journaux' },
  { label: 'Plan comptable', url: '/app/plan-comptable' },
  { label: 'Tiers', url: '/app/tiers' },
  { label: 'Trésorerie', url: '/app/tresorerie' },
  { label: 'Rapports', children: [{ label: 'Balance générale', url: '/app/rapports/balance' }] },
  { label: 'Plus', children: [{ label: 'Immobilisations', url: '/app/immobilisations' }] },
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
    return fixture.nativeElement as HTMLElement;
  }

  const texts = (list: Element | null) =>
    Array.from(list?.querySelectorAll(':scope > li') ?? []).map((item) => item.textContent?.trim());

  it('wide screens: every entry, links then menus, in a labelled navigation', async () => {
    const element = await setup();
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Navigation Test');
    expect(texts(element.querySelector('.entries--full'))).toEqual(ENTRIES.map((e) => e.label));
    expect(element.querySelector('aside')).toBeNull();
  });

  it('tablets: the first entries, then one « Plus » holding the rest', async () => {
    const element = await setup();
    expect(texts(element.querySelector('.entries--tablet'))).toEqual([
      'Tableau de bord',
      'Écritures',
      'Journaux',
      'Plan comptable',
      'Plus',
    ]);
  });

  it('short menus never collapse on tablets', async () => {
    const element = await setup(null);
    expect(element.querySelector('.entries--tablet')).toBeNull();
  });

  it('phones: one menu named after the navigation and the current screen', async () => {
    const element = await setup();
    const trigger = element.querySelector('.compact button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('Navigation Test : Menu');
  });
});
