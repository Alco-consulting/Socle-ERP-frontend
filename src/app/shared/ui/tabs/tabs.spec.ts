import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AlcoTabPanel, AlcoTabs } from './tabs';

@Component({
  imports: [AlcoTabs, AlcoTabPanel],
  template: `
    <alco-tabs
      label="Détail"
      [tabs]="[
        { id: 'lines', label: 'Lignes', count: 2 },
        { id: 'docs', label: 'Pièces' },
        { id: 'advanced', label: 'Avancé', invalid: true },
      ]"
      [(selected)]="tab"
    >
      <ng-template alcoTabPanel="lines"><p>Contenu lignes</p></ng-template>
      <ng-template alcoTabPanel="docs"><p>Contenu pièces</p></ng-template>
      <ng-template alcoTabPanel="advanced"><p>Contenu avancé</p></ng-template>
    </alco-tabs>
  `,
})
class Host {
  readonly tab = signal('lines');
}

describe('AlcoTabs', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const tabs = () => Array.from(element.querySelectorAll<HTMLButtonElement>('[role=tab]'));
    return { fixture, element, tabs, host: fixture.componentInstance };
  }

  it('renders only the active panel, labelled by its tab', async () => {
    const { element, tabs } = await setup();
    const panel = element.querySelector('[role=tabpanel]') as HTMLElement;
    expect(panel.textContent).toContain('Contenu lignes');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[0].id);
    expect(element.textContent).not.toContain('Contenu pièces');
  });

  it('only the active tab is in the tab order', async () => {
    const { tabs } = await setup();
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it('arrow keys, Home and End move between tabs', async () => {
    const { fixture, tabs, host } = await setup();
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    expect(host.tab()).toBe('docs');
    tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    await fixture.whenStable();
    expect(host.tab()).toBe('advanced');
    tabs()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    expect(host.tab()).toBe('lines');
  });

  it('flags a tab containing errors in words for screen readers', async () => {
    const { tabs } = await setup();
    expect(tabs()[2].textContent).toContain('(à corriger)');
  });
});
