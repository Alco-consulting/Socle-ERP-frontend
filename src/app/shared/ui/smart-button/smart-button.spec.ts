import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AlcoSmartButton } from './smart-button';

@Component({
  imports: [AlcoSmartButton],
  template: `
    <alco-smart-button
      label="Écritures"
      icon="accounting"
      [count]="count()"
      link="/app/comptabilite/ecritures"
      [queryParams]="{ compte: '401' }"
    />
    <alco-smart-button label="Grand livre" icon="book" link="/grand-livre" />
    <alco-smart-button label="Lettrage" icon="check" unavailable="Pas encore disponible." />
  `,
})
class Host {
  readonly count = signal<number | null>(null);
}

describe('AlcoSmartButton', () => {
  async function setup() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('a link with the API’s count, announced as « Libellé : nombre »', async () => {
    const { fixture, element } = await setup();
    const link = element.querySelector('a.smart') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/comptabilite/ecritures?compte=401');
    // Loading: « … », said busy.
    expect(link.getAttribute('aria-label')).toBe('Écritures : chargement');
    expect(link.getAttribute('aria-busy')).toBe('true');
    expect(link.textContent).toContain('…');
    fixture.componentInstance.count.set(48);
    await fixture.whenStable();
    expect(link.getAttribute('aria-label')).toBe('Écritures : 48');
    expect(link.getAttribute('aria-busy')).toBeNull();
    expect(link.querySelector('.count')?.textContent).toBe('48');
  });

  it('without a count for the relation: the label only, no figure invented', async () => {
    const { element } = await setup();
    const ledger = element.querySelectorAll('a.smart')[1];
    expect(ledger.getAttribute('aria-label')).toBe('Grand livre');
    expect(ledger.querySelector('.count')).toBeNull();
  });

  it('unavailable: a focusable, disabled button with its reason, never a link', async () => {
    const { element } = await setup();
    const button = element.querySelector('button.smart') as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.closest('a')).toBeNull();
    expect(button.tabIndex).toBe(0);
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(reason?.getAttribute('role')).toBe('tooltip');
    expect(reason?.textContent).toBe('Pas encore disponible.');
  });
});
