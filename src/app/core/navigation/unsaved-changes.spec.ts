import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SessionStore } from '../session/session.store';
import { openTestSession } from '../session/testing';
import {
  UNSAVED_CHANGES_QUESTION,
  UnsavedChangesService,
  unsavedChangesGuard,
} from './unsaved-changes';

let dirty = false;

@Component({ template: 'Formulaire' })
class FormScreen {
  constructor() {
    inject(UnsavedChangesService).track(() => dirty);
  }
}

@Component({ template: 'Ailleurs' })
class OtherScreen {}

describe('UnsavedChangesService and unsavedChangesGuard', () => {
  let ask: ReturnType<typeof vi.spyOn>;

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'form', component: FormScreen, canDeactivate: [unsavedChangesGuard] },
          { path: 'other', component: OtherScreen },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions: [] });
    ask = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm');
    const harness = await RouterTestingHarness.create('/form');
    return { harness, router: TestBed.inject(Router) };
  }

  beforeEach(() => (dirty = false));

  it('nothing changed: leaves without a question', async () => {
    const { harness, router } = await open();
    await harness.navigateByUrl('/other');
    expect(ask).not.toHaveBeenCalled();
    expect(router.url).toBe('/other');
  });

  it('changes not saved: asks; « Continuer l’édition » stays, « Quitter » leaves', async () => {
    const { harness, router } = await open();
    dirty = true;
    ask.mockResolvedValueOnce(false);
    await harness.navigateByUrl('/other');
    expect(ask).toHaveBeenCalledWith(UNSAVED_CHANGES_QUESTION);
    expect(router.url).toBe('/form');

    ask.mockResolvedValueOnce(true);
    await harness.navigateByUrl('/other');
    expect(router.url).toBe('/other');
    // The screen is gone: nothing tracked any more.
    expect(TestBed.inject(UnsavedChangesService).hasChanges()).toBe(false);
  });

  it('the session ended: no question (the login screen takes over)', async () => {
    const { harness, router } = await open();
    dirty = true;
    TestBed.inject(SessionStore).setStatus('anonymous');
    await harness.navigateByUrl('/other');
    expect(ask).not.toHaveBeenCalled();
    expect(router.url).toBe('/other');
  });

  it('closing the tab with changes: the browser asks', async () => {
    await open();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    dirty = true;
    const second = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
  });
});
