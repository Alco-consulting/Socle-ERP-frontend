import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AlcoSearchBar, SearchFacet } from './search-bar';

@Component({
  imports: [AlcoSearchBar],
  template: `
    <alco-search-bar
      label="Rechercher une écriture"
      [(query)]="query"
      [facets]="facets()"
      (facetRemoved)="removed.push($event.id)"
    />
  `,
})
class Host {
  readonly query = signal('');
  readonly facets = signal<SearchFacet[]>([
    { id: 'status', kind: 'filter', label: 'État', value: 'Brouillon' },
    { id: 'group', kind: 'group', label: 'Regroupé par', value: 'Journal' },
  ]);
  readonly removed: string[] = [];
}

describe('AlcoSearchBar', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector('input') as HTMLInputElement;
    return { fixture, element, input, host: fixture.componentInstance };
  }

  it('shows active criteria as chips with an explicit remove button', async () => {
    const { element, host } = await setup();
    const remove = element.querySelector('.facet-remove') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Retirer le critère État : Brouillon');
    remove.click();
    expect(host.removed).toEqual(['status']);
  });

  it('updates the query as the user types', async () => {
    const { input, host } = await setup();
    input.value = 'FAC-2026';
    input.dispatchEvent(new Event('input'));
    expect(host.query()).toBe('FAC-2026');
  });

  it('Backspace in an empty box removes the last criterion', async () => {
    const { input, host } = await setup();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(host.removed).toEqual(['group']);
  });

  it('has an accessible name and a search landmark', async () => {
    const { element, input } = await setup();
    expect(input.getAttribute('aria-label')).toBe('Rechercher une écriture');
    expect(element.querySelector('[role=search]')).not.toBeNull();
  });
});
