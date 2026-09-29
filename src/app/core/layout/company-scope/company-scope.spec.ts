import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { SessionStore } from '../../session/session.store';
import { openTestSession } from '../../session/testing';
import { AlcoCompanyScope } from './company-scope';

let created = 0;

@Component({
  template: `<main id="contenu" tabindex="-1"><h1>Écritures</h1></main>`,
})
class Screen {
  constructor() {
    created++;
  }
}

describe('AlcoCompanyScope (screens rebuilt for the new company)', () => {
  async function render() {
    created = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'app', component: AlcoCompanyScope, children: [{ path: '', component: Screen }] },
        ]),
      ],
    });
    const store = TestBed.inject(SessionStore);
    openTestSession(store);
    const harness = await RouterTestingHarness.create('/app');
    const element = harness.fixture.nativeElement as HTMLElement;
    return { store, harness, element };
  }

  it('removes every screen at once while the company changes, then creates them again', async () => {
    const { store, harness, element } = await render();
    expect(element.querySelector('h1')?.textContent).toBe('Écritures');
    expect(created).toBe(1);

    store.setActivity('switching-company');
    await harness.fixture.whenStable();
    expect(element.querySelector('h1')).toBeNull(); // nothing of the previous company
    expect(element.textContent).toContain('Changement de société…');
    expect(element.querySelector('[role=status]')?.textContent).toContain(
      'Changement de société en cours…',
    );

    store.setActivity(null);
    await harness.fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe('Écritures');
    expect(created).toBe(2); // a new screen: it loads the new company's data
    expect(document.activeElement?.id).toBe('contenu');
  });

  it('other session activities keep the screens', async () => {
    const { store, harness, element } = await render();
    store.setActivity('signing-out');
    await harness.fixture.whenStable();
    expect(element.querySelector('h1')).not.toBeNull();
    expect(created).toBe(1);
  });
});
