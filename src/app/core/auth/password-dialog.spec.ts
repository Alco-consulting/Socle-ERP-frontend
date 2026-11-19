import { DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { clearCookie, envelope, httpMock, provideHttpTesting, setCookie } from '../http/testing';
import { AlcoPasswordDialog } from './password-dialog';

const URL = '/api/v1/auth/password/change/';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function invalid(details: Record<string, { code: string; message: string }[]>) {
  return { error: { ...envelope('validation_error').error, details } };
}

describe('AlcoPasswordDialog', () => {
  let fixture: ComponentFixture<AlcoPasswordDialog>;
  let element: HTMLElement;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    setCookie('XSRF-TOKEN', 'tok');
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [AlcoPasswordDialog],
      providers: [...provideHttpTesting(), { provide: DialogRef, useValue: { close } }],
    });
    fixture = TestBed.createComponent(AlcoPasswordDialog);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  const field = (name: string) =>
    element.querySelector<HTMLInputElement>(`input[formcontrolname=${name}]`)!;
  const errors = () =>
    Array.from(element.querySelectorAll('alco-form-field .error')).map((e) =>
      e.textContent?.trim(),
    );
  const alertText = () => element.querySelector('[role=alert]')?.textContent ?? '';

  async function fill(current: string, fresh: string, confirmation = fresh): Promise<void> {
    for (const [name, value] of [
      ['current_password', current],
      ['new_password', fresh],
      ['confirmation', confirmation],
    ]) {
      field(name).value = value;
      field(name).dispatchEvent(new Event('input'));
    }
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  async function answer(body: object | null, status = 204): Promise<void> {
    httpMock().expectOne(URL).flush(body, { status, statusText: 'x' });
    await settle();
    await fixture.whenStable();
  }

  it('three password fields, the browser knows which is which', () => {
    const labels = Array.from(element.querySelectorAll('label')).map((l) => l.textContent?.trim());
    expect(labels).toEqual([
      'Mot de passe actuel *',
      'Nouveau mot de passe *',
      'Confirmer le nouveau mot de passe *',
    ]);
    expect(field('current_password').type).toBe('password');
    expect(field('current_password').autocomplete).toBe('current-password');
    expect(field('new_password').autocomplete).toBe('new-password');
  });

  it('success: exact payload, the dialog closes as changed', async () => {
    await fill('ancien secret', 'un nouveau secret long');
    const request = httpMock().expectOne(URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      current_password: 'ancien secret',
      new_password: 'un nouveau secret long',
    });
    request.flush(null, { status: 204, statusText: 'x' });
    await settle();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('a confirmation that differs is refused before any request', async () => {
    await fill('ancien secret', 'un nouveau secret long', 'un autre secret long');
    httpMock().expectNone(URL);
    expect(errors()).toEqual(['Les deux mots de passe ne correspondent pas.']);
    expect(close).not.toHaveBeenCalled();
  });

  it('a wrong current password is said under its field', async () => {
    await fill('faux', 'un nouveau secret long');
    await answer(invalid({ current_password: [{ code: 'incorrect', message: 'x' }] }), 400);
    expect(errors()).toEqual(['Mot de passe actuel incorrect.']);
    expect(close).not.toHaveBeenCalled();
  });

  it('the server rules on the new password are said in French under it', async () => {
    await fill('ancien secret', 'court');
    await answer(invalid({ new_password: [{ code: 'password_too_short', message: 'x' }] }), 400);
    expect(errors()).toEqual(['12 caractères au minimum.']);
  });

  it('too many attempts: a general message, the dialog stays open', async () => {
    await fill('ancien secret', 'un nouveau secret long');
    await answer(envelope('throttled'), 429);
    expect(alertText()).not.toBe('');
    expect(alertText()).not.toContain('throttled');
    expect(close).not.toHaveBeenCalled();
  });
});
