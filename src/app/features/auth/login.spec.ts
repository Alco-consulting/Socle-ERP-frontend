import { HttpHeaders } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { SessionService } from '../../core/auth/session.service';
import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../core/http/testing';
import { LoginPage } from './login';

const USER = {
  public_id: 'u-1',
  email: 'mariam.test@example.org',
  first_name: 'Mariam',
  last_name: 'Test',
  is_active: true,
  permissions: [],
};
const CONTEXT = { current: null, default_company: null, companies: [] };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let element: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function setup(query: Record<string, string> = {}, config = {}) {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        ...provideHttpTesting(config),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(query)) } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    // The login screen is shown to anonymous visitors.
    const session = TestBed.inject(SessionService);
    const loaded = session.ensureLoaded();
    httpMock()
      .expectOne('/api/v1/auth/me/')
      .flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
    await loaded;
    fixture = TestBed.createComponent(LoginPage);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  const email = () => element.querySelector<HTMLInputElement>('input[type=email]')!;
  const password = () =>
    element.querySelector<HTMLInputElement>('input[autocomplete=current-password]')!;
  const submit = () => element.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const alertText = () => element.querySelector('[role=alert]')?.textContent ?? '';

  async function fill(address = 'mariam.test@example.org', secret = 'correct horse battery') {
    email().value = address;
    email().dispatchEvent(new Event('input'));
    password().value = secret;
    password().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function send(): Promise<void> {
    submit().click();
    await fixture.whenStable();
  }

  async function answerLogin(body: object | string, status = 200, headers?: HttpHeaders) {
    const request = httpMock().expectOne('/api/v1/auth/login/');
    request.flush(body, { status, statusText: 'x', headers });
    await settle();
    await fixture.whenStable();
    return request;
  }

  beforeEach(() => setCookie('XSRF-TOKEN', 'tok'));
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('labels, autocomplete hints and focus on the e-mail field', async () => {
    await setup();
    const labels = Array.from(element.querySelectorAll('label')).map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Adresse e-mail *', 'Mot de passe *']);
    expect(email().getAttribute('autocomplete')).toBe('username');
    expect(document.activeElement).toBe(email());
  });

  it('success: exact payload, company context, then the requested page (safe)', async () => {
    await setup({ retour: '/app/comptabilite/ecritures' });
    await fill();
    await send();
    expect(submit().getAttribute('aria-busy')).toBe('true');
    const request = await answerLogin(USER);
    expect(request.request.body).toEqual({
      email: 'mariam.test@example.org',
      password: 'correct horse battery',
    });
    httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/app/comptabilite/ecritures');
  });

  it('an external return address is ignored', async () => {
    await setup({ retour: 'https://evil.example/app' });
    await fill();
    await send();
    await answerLogin(USER);
    httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
    await settle();
    expect(navigate).toHaveBeenCalledWith('/app');
  });

  it('wrong password: human message, no hint about the account, password cleared and focused', async () => {
    await setup();
    await fill();
    await send();
    await answerLogin(envelope('invalid_credentials'), 400);
    expect(alertText()).toContain('Adresse e-mail ou mot de passe incorrect.');
    expect(alertText()).not.toContain('invalid_credentials');
    expect(password().value).toBe('');
    expect(email().value).toBe('mariam.test@example.org');
    expect(document.activeElement).toBe(password());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('disabled account: exactly the same answer (the API does not tell them apart)', async () => {
    await setup();
    await fill('disabled.account@example.org');
    await send();
    await answerLogin(envelope('invalid_credentials'), 400);
    expect(alertText()).toContain('Adresse e-mail ou mot de passe incorrect.');
  });

  it('429: « too many attempts », waits Retry-After before allowing a new attempt', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await setup();
      await fill();
      await send();
      await answerLogin(envelope('throttled'), 429, new HttpHeaders({ 'Retry-After': '3' }));
      expect(alertText()).toContain('Trop de tentatives.');
      expect(alertText()).toContain('Veuillez patienter 3 secondes avant de réessayer.');
      expect(submit().disabled).toBe(true);
      expect(submit().textContent).toContain('Réessayez dans 3 s');
      await send(); // ignored while waiting
      httpMock().expectNone('/api/v1/auth/login/');
      vi.advanceTimersByTime(3000);
      await fixture.whenStable();
      expect(submit().disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [500, envelope('server_error'), 'Une erreur inattendue s’est produite.'],
    [503, envelope('unavailable'), 'Le service est momentanément indisponible.'],
    [502, '<html>Bad gateway</html>', 'Le service est momentanément indisponible.'],
  ])('HTTP %s: plain message, never a raw technical error', async (status, body, message) => {
    await setup();
    await fill();
    await send();
    await answerLogin(body, status);
    expect(alertText()).toContain(message);
    expect(alertText()).not.toContain('<html>');
    expect(submit().disabled).toBe(false);
  });

  it('network failure', async () => {
    await setup();
    await fill();
    await send();
    httpMock().expectOne('/api/v1/auth/login/').error(new ProgressEvent('error'), { status: 0 });
    await settle();
    await fixture.whenStable();
    expect(alertText()).toContain('Le serveur ne répond pas.');
  });

  it('timeout', async () => {
    await setup({}, { requestTimeoutMs: 10 });
    await fill();
    await send();
    httpMock().expectOne('/api/v1/auth/login/');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await fixture.whenStable();
    expect(alertText()).toContain('Le serveur met trop de temps à répondre.');
    expect(submit().disabled).toBe(false);
  });

  it('field errors of the server are shown under the field and linked to it', async () => {
    await setup();
    await fill('bad@', 'x');
    // Bypass the client check to reach the server's own validation.
    const page = fixture.componentInstance as unknown as {
      form: {
        controls: { email: { setValidators(v: null): void; updateValueAndValidity(): void } };
      };
    };
    page.form.controls.email.setValidators(null);
    page.form.controls.email.updateValueAndValidity();
    await send();
    await answerLogin(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid input.',
          details: { email: [{ message: 'Enter a valid email address.', code: 'invalid' }] },
          correlation_id: 'c',
        },
      },
      400,
    );
    const error = element.querySelector('.error') as HTMLElement;
    expect(error.textContent).toContain('Saisissez une adresse e-mail valide.');
    expect(email().getAttribute('aria-invalid')).toBe('true');
    expect(email().getAttribute('aria-describedby')).toContain(error.id);
    expect(document.activeElement).toBe(email());
  });

  it('client check: empty or obviously invalid input never reaches the server', async () => {
    await setup();
    await send();
    httpMock().expectNone('/api/v1/auth/login/');
    expect(element.textContent).toContain('Ce champ est obligatoire.');
    expect(document.activeElement).toBe(email());
  });

  it('double click: one request only', async () => {
    await setup();
    await fill();
    submit().click();
    submit().click();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await answerLogin(USER); // expectOne: exactly one login request
    httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
    await settle();
  });

  it('show / hide the password, announced as a toggle', async () => {
    await setup();
    const toggle = element.querySelector<HTMLButtonElement>('.reveal')!;
    expect(password().type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(password().type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Masquer le mot de passe');
  });

  it('explains why the user is here: expired session, logout', async () => {
    await setup({ raison: 'session-expiree' });
    expect(element.textContent).toContain('Votre session a expiré.');
  });

  it('never stores the password or a token in the browser', async () => {
    localStorage.clear();
    sessionStorage.clear();
    await setup();
    await fill('mariam.test@example.org', 'correct horse battery');
    await send();
    await answerLogin(USER);
    httpMock().expectOne('/api/v1/company-context/').flush(CONTEXT);
    await settle();
    const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(stored).not.toContain('correct horse battery');
    expect(stored.toLowerCase()).not.toMatch(/token|sessionid|jwt/);
  });
});
