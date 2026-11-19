import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AccountingSettingsPage } from './accounting-settings-page';

const URL = '/api/v1/accounting/settings/';
const SETTINGS = { submission_required: true, parent_accounts_postable: false };
const BOTH = ['accounting.read', 'accounting.manage_journals', 'accounting.manage_accounts'];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Paramètres comptables (accounting/settings/)', () => {
  let fixture: ComponentFixture<AccountingSettingsPage>;
  let element: HTMLElement;

  async function open(permissions: readonly string[] = BOTH): Promise<void> {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    fixture = TestBed.createComponent(AccountingSettingsPage);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    httpMock().expectOne({ method: 'GET', url: URL }).flush(SETTINGS);
    await settle();
    await fixture.whenStable();
  }

  const box = (name: string) =>
    element.querySelector<HTMLInputElement>(`input[formcontrolname=${name}]`)!;
  const saveButton = () => element.querySelector<HTMLButtonElement>('button[type=submit]');

  async function toggle(name: string): Promise<void> {
    box(name).click();
    await fixture.whenStable();
  }

  async function save(): Promise<void> {
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  beforeEach(() => setCookie('XSRF-TOKEN', 'tok'));
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('shows the company settings, each box with its explanation', async () => {
    await open();
    expect(box('submission_required').checked).toBe(true);
    expect(box('parent_accounts_postable').checked).toBe(false);
    expect(box('submission_required').getAttribute('aria-describedby')).toBe('submission-help');
    expect(element.textContent).toContain('Soumettre les écritures avant de les valider');
  });

  it('saves only the setting changed, then says so', async () => {
    await open();
    await toggle('submission_required');
    await save();
    const request = httpMock().expectOne({ method: 'PUT', url: URL });
    expect(request.request.body).toEqual({ submission_required: false });
    request.flush({ ...SETTINGS, submission_required: false });
    await settle();
    await fixture.whenStable();
    expect(box('submission_required').checked).toBe(false);
    expect(element.textContent).not.toContain('Annuler');
  });

  it('nothing changed: no request', async () => {
    await open();
    await save();
    httpMock().expectNone({ method: 'PUT', url: URL });
  });

  it('each box needs its own permission', async () => {
    await open(['accounting.read', 'accounting.manage_accounts']);
    expect(box('submission_required').disabled).toBe(true);
    expect(box('parent_accounts_postable').disabled).toBe(false);
    expect(element.textContent).toContain('Réservé aux personnes qui gèrent les journaux.');
  });

  it('a reader only reads: no save button', async () => {
    await open(['accounting.read']);
    expect(saveButton()).toBeNull();
    expect(box('submission_required').disabled).toBe(true);
    expect(element.textContent).toContain('Paramètres en lecture seule');
  });

  it('a refusal of the server is said, the choice stays to retry', async () => {
    await open();
    await toggle('parent_accounts_postable');
    await save();
    httpMock()
      .expectOne({ method: 'PUT', url: URL })
      .flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
    await settle();
    await fixture.whenStable();
    expect(element.querySelector('alco-error-state')).not.toBeNull();
    expect(box('parent_accounts_postable').checked).toBe(true);
  });
});
