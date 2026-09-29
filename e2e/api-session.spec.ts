import AxeBuilder from '@axe-core/playwright';
import { Page, Request, expect, test } from '@playwright/test';

/**
 * API mode (`development-api`): the real HTTP layer (session cookie, CSRF, X-Company-ID,
 * errors) and the real login screen in a real browser. Every `/api/v1/…` request is answered
 * here by a small stateful fake of the Django contract (session open after a good login,
 * CSRF token rotated at login, session closed at logout) — nothing reaches the deployed API
 * and no real account is used (an unexpected call gets a 404 and fails the test).
 */

const A = {
  public_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  legal_name: 'Alco Guinée SARL (test)',
  trade_name: 'ALCO GUINÉE (test)',
  country: 'GN',
  reference_currency: 'GNF',
  status: 'active',
};
const B = {
  ...A,
  public_id: 'bbbbbbbb-0000-4000-8000-000000000002',
  legal_name: 'Filiale Sénégal SA (test)',
  trade_name: 'FILIALE SÉNÉGAL (test)',
  country: 'SN',
  reference_currency: 'XOF',
};
const USER = {
  public_id: 'u-1',
  email: 'mariam.test@example.org',
  first_name: 'Mariam',
  last_name: 'Test',
  is_active: true,
  permissions: [] as string[],
};
const PASSWORD = 'fictitious test password';
/** An address the fake server throttles (429, Retry-After: 30). */
const THROTTLED = 'trop.de.tentatives@example.org';

const error = (code: string) => ({
  error: { code, message: code, details: null, correlation_id: 'e2e' },
});

interface ApiOptions {
  /** Session open at start (`user`), closed (`anonymous`), or server unreachable. */
  readonly me?: 'user' | 'anonymous' | 'unreachable';
  readonly permissions?: Readonly<Record<string, readonly string[]>>;
  /** Answer 403 `not_authenticated` to this company's context (session ended meanwhile). */
  readonly expiresOn?: string;
  /** Delay of the login answer (double click test). */
  readonly loginDelayMs?: number;
}

async function setCsrfCookie(page: Page, value: string): Promise<void> {
  // What Django's Set-Cookie does: a readable XSRF-TOKEN cookie on the page's origin.
  await page.context().addCookies([{ name: 'XSRF-TOKEN', value, url: new URL(page.url()).origin }]);
}

async function mockApi(page: Page, options: ApiOptions = {}): Promise<Request[]> {
  const calls: Request[] = [];
  let signedIn = options.me === undefined || options.me === 'user';
  let csrf = '';
  const permissions = options.permissions ?? {
    [A.public_id]: ['accounting.read', 'reporting.read'],
    [B.public_id]: ['accounting.read', 'partners.read', 'dashboards.read'],
  };

  // Registered first = tried last: anything unexpected is refused.
  await page.route('**/api/v1/**', (route) => {
    calls.push(route.request());
    return route.fulfill({ status: 404, json: error('not_found') });
  });
  await page.route('**/api/v1/auth/me/', (route) => {
    calls.push(route.request());
    if (options.me === 'unreachable') {
      return route.abort('connectionrefused');
    }
    return signedIn
      ? route.fulfill({ status: 200, json: USER })
      : route.fulfill({ status: 403, json: error('not_authenticated') });
  });
  await page.route('**/api/v1/company-context/', async (route) => {
    calls.push(route.request());
    const requested = (await route.request().headerValue('x-company-id')) ?? A.public_id;
    if (!signedIn || requested === options.expiresOn) {
      return route.fulfill({ status: 403, json: error('not_authenticated') });
    }
    const company = requested === B.public_id ? B : A;
    return route.fulfill({
      status: 200,
      json: {
        current: { company, permissions: permissions[company.public_id] ?? [] },
        default_company: A.public_id,
        companies: [A, B],
      },
    });
  });
  await page.route('**/api/v1/auth/csrf/', async (route) => {
    calls.push(route.request());
    csrf = 'tok-e2e';
    await setCsrfCookie(page, csrf);
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/auth/login/', async (route) => {
    calls.push(route.request());
    if ((await route.request().headerValue('x-xsrf-token')) !== csrf || !csrf) {
      return route.fulfill({ status: 403, json: error('csrf_failed') });
    }
    if (options.loginDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.loginDelayMs));
    }
    const body = route.request().postDataJSON() as { email: string; password: string };
    if (body.email === THROTTLED) {
      return route.fulfill({
        status: 429,
        headers: { 'Retry-After': '30' },
        json: error('throttled'),
      });
    }
    if (body.email !== USER.email || body.password !== PASSWORD) {
      return route.fulfill({ status: 400, json: error('invalid_credentials') });
    }
    signedIn = true;
    csrf = 'tok-after-login'; // Django rotates the token at login
    await setCsrfCookie(page, csrf);
    return route.fulfill({ status: 200, json: USER });
  });
  await page.route('**/api/v1/auth/logout/', async (route) => {
    calls.push(route.request());
    if ((await route.request().headerValue('x-xsrf-token')) !== csrf || !csrf) {
      return route.fulfill({ status: 403, json: error('csrf_failed') });
    }
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  return calls;
}

const tiles = (page: Page) => page.locator('.tile-label');
const callsTo = (calls: Request[], path: string) =>
  calls.filter((call) => new URL(call.url()).pathname === `/api/v1/${path}`);

async function logIn(page: Page, email = USER.email, password = PASSWORD): Promise<void> {
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test.describe('Mode API — connexion', () => {
  test('login → session → company context → App Launcher; still connected after a refresh', async ({
    page,
  }) => {
    const calls = await mockApi(page, { me: 'anonymous' });
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?retour=%2Fapp$/);
    await expect(page.getByLabel('Adresse e-mail')).toBeFocused();
    await logIn(page);

    await expect(page).toHaveURL(/\/app$/);
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Reporting']);
    const [csrfCall] = callsTo(calls, 'auth/csrf/');
    const [login] = callsTo(calls, 'auth/login/');
    expect(calls.indexOf(csrfCall)).toBeLessThan(calls.indexOf(login));
    expect(login.postDataJSON()).toEqual({ email: USER.email, password: PASSWORD });
    expect(await login.headerValue('x-xsrf-token')).toBe('tok-e2e');
    expect(await login.headerValue('x-company-id')).toBeNull();
    expect(callsTo(calls, 'auth/me/').length).toBe(1); // only the start check

    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Reporting']);
  });

  test('back to the page asked before login', async ({ page }) => {
    await mockApi(page, { me: 'anonymous' });
    await page.goto('/app/comptabilite/ecritures');
    await logIn(page);
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures');
  });

  test('an external return address is never followed', async ({ page }) => {
    await mockApi(page, { me: 'anonymous' });
    await page.goto('/login?retour=https%3A%2F%2Fevil.example%2F');
    await logIn(page);
    await expect(page).toHaveURL(/localhost:\d+\/app$/);
  });

  test('wrong credentials: human message, password cleared and focused', async ({ page }) => {
    await mockApi(page, { me: 'anonymous' });
    await page.goto('/login');
    await logIn(page, USER.email, 'not the password');
    await expect(page.getByRole('alert')).toContainText(
      'Adresse e-mail ou mot de passe incorrect.',
    );
    await expect(page.getByRole('alert')).not.toContainText('invalid_credentials');
    await expect(page.getByRole('textbox', { name: 'Mot de passe', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Mot de passe', exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rate limit (429): message and wait from Retry-After', async ({ page }) => {
    await mockApi(page, { me: 'anonymous' });
    await page.goto('/login');
    await logIn(page, THROTTLED, 'whatever');
    await expect(page.getByRole('alert')).toContainText('Trop de tentatives.');
    await expect(page.getByRole('alert')).toContainText('30 secondes');
    const button = page.getByRole('button', { name: /Réessayez dans \d+ s/ });
    await expect(button).toBeDisabled();
  });

  test('double click: one login request', async ({ page }) => {
    const calls = await mockApi(page, { me: 'anonymous', loginDelayMs: 600 });
    await page.goto('/login');
    await page.getByLabel('Adresse e-mail').fill(USER.email);
    await page.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).dblclick();
    await expect(page.getByRole('button', { name: 'Connexion en cours…' })).toBeDisabled();
    await expect(page).toHaveURL(/\/app$/);
    expect(callsTo(calls, 'auth/login/').length).toBe(1);
  });

  test('nothing sensitive is stored by the front end', async ({ page }) => {
    await mockApi(page, { me: 'anonymous' });
    await page.goto('/login');
    await logIn(page);
    await expect(tiles(page)).toHaveCount(2);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored).not.toContain(PASSWORD);
    expect(stored.toLowerCase()).not.toMatch(/token|sessionid|jwt|password/);
  });

  test('login screen: no accessibility violation, error announced, fits a phone', async ({
    page,
  }) => {
    await mockApi(page, { me: 'anonymous' });
    await page.goto('/login');
    await logIn(page, USER.email, 'not the password');
    await expect(page.getByRole('alert')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('an open session skips the login screen', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('Mode API — session Django, CSRF, contexte société', () => {
  test('an anonymous visitor goes to the login screen, with the page to come back to', async ({
    page,
  }) => {
    await mockApi(page, { me: 'anonymous' });
    await page.goto('/app/comptabilite/ecritures');
    await expect(page).toHaveURL(/\/login\?retour=%2Fapp%2Fcomptabilite%2Fecritures$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion');
    await expect(page.getByRole('note', { name: 'Prototype' })).toHaveCount(0);
  });

  test('the session and the company context come from the API', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Reporting']);
    await expect(
      page.getByRole('button', { name: /Société active : ALCO GUINÉE \(test\)/ }),
    ).toBeVisible();
    await expect(page.getByText('Bonjour Mariam')).toBeVisible();
    const [me] = callsTo(calls, 'auth/me/');
    expect(await me.headerValue('x-company-id')).toBeNull();
    expect(await me.headerValue('authorization')).toBeNull(); // no token: the session is a cookie
  });

  test('switching company asks its context with X-Company-ID; permissions follow', async ({
    page,
  }) => {
    const calls = await mockApi(page);
    await page.goto('/app');
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Reporting']);
    await page.getByRole('button', { name: /Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Tiers', 'Tableau de bord']);
    const switchCall = callsTo(calls, 'company-context/').at(-1);
    expect(await switchCall?.headerValue('x-company-id')).toBe(B.public_id);
  });

  test('logout: CSRF cookie fetched then sent; the session is closed on the server', async ({
    page,
  }) => {
    const calls = await mockApi(page);
    await page.goto('/app');
    await expect(tiles(page)).toHaveCount(2);
    await page.getByRole('button', { name: /Compte de Mariam Test/ }).click();
    await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login\?raison=deconnexion$/);
    await expect(page.getByText('Vous êtes déconnecté.')).toBeVisible();
    const [csrfCall] = callsTo(calls, 'auth/csrf/');
    const [logout] = callsTo(calls, 'auth/logout/');
    expect(calls.indexOf(csrfCall)).toBeLessThan(calls.indexOf(logout));
    expect(logout.method()).toBe('POST');
    expect(await logout.headerValue('x-xsrf-token')).toBe('tok-e2e');
    expect(await logout.headerValue('x-company-id')).toBeNull();

    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?retour=%2Fapp$/);
  });

  test('a session ending during work: back to the login screen, once, with the reason', async ({
    page,
  }) => {
    const calls = await mockApi(page, { expiresOn: B.public_id });
    await page.goto('/app');
    await expect(tiles(page)).toHaveCount(2);
    await page.getByRole('button', { name: /Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(/\/login\?raison=session-expiree&retour=%2Fapp$/);
    await expect(page.getByText('Votre session a expiré.', { exact: false })).toBeVisible();
    expect(callsTo(calls, 'auth/me/').length).toBe(1); // no loop of session checks

    // Logging in again resumes where the user was.
    await logIn(page);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('server unreachable at startup: said plainly, with a retry', async ({ page }) => {
    await mockApi(page, { me: 'unreachable' });
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?raison=indisponible/);
    await expect(page.getByText('Le serveur ne répond pas.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  });
});
