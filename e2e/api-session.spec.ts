import { Page, Request, expect, test } from '@playwright/test';

/**
 * API mode (`development-api`): the real HTTP layer (session cookie, CSRF, X-Company-ID,
 * errors) in a real browser. Every `/api/v1/…` request is answered here — nothing reaches
 * the deployed API (an unexpected call gets a 404 and fails the test).
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

const error = (code: string) => ({
  error: { code, message: code, details: null, correlation_id: 'e2e' },
});

interface ApiOptions {
  readonly me?: 'user' | 'anonymous' | 'unreachable';
  readonly permissions?: Readonly<Record<string, readonly string[]>>;
  /** Answer 403 `not_authenticated` to this company's context (session ended meanwhile). */
  readonly expiresOn?: string;
}

async function mockApi(page: Page, options: ApiOptions = {}): Promise<Request[]> {
  const calls: Request[] = [];
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
    return options.me === 'anonymous'
      ? route.fulfill({ status: 403, json: error('not_authenticated') })
      : route.fulfill({ status: 200, json: USER });
  });
  await page.route('**/api/v1/company-context/', async (route) => {
    calls.push(route.request());
    const requested = (await route.request().headerValue('x-company-id')) ?? A.public_id;
    if (requested === options.expiresOn) {
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
    // What Django's Set-Cookie does: a readable XSRF-TOKEN cookie on the page's origin.
    await page
      .context()
      .addCookies([{ name: 'XSRF-TOKEN', value: 'tok-e2e', url: new URL(page.url()).origin }]);
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/auth/logout/', (route) => {
    calls.push(route.request());
    return route.fulfill({ status: 204 });
  });
  return calls;
}

const tiles = (page: Page) => page.locator('.tile-label');

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
    const me = calls.find((call) => call.url().endsWith('/auth/me/'));
    expect(await me?.headerValue('x-company-id')).toBeNull();
    const cookies = await me?.allHeaders();
    expect(cookies?.['authorization']).toBeUndefined(); // no token: the session is a cookie
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
    const switchCall = calls.filter((call) => call.url().endsWith('/company-context/')).at(-1);
    expect(await switchCall?.headerValue('x-company-id')).toBe(B.public_id);
  });

  test('logout: the CSRF cookie is fetched, then sent as X-XSRF-TOKEN', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/app');
    await expect(tiles(page)).toHaveCount(2);
    await page.getByRole('button', { name: /Compte de Mariam Test/ }).click();
    await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login$/);
    const urls = calls.map((call) => new URL(call.url()).pathname);
    expect(urls.indexOf('/api/v1/auth/csrf/')).toBeLessThan(urls.indexOf('/api/v1/auth/logout/'));
    const logout = calls.find((call) => call.url().endsWith('/auth/logout/'));
    expect(logout?.method()).toBe('POST');
    expect(await logout?.headerValue('x-xsrf-token')).toBe('tok-e2e');
    expect(await logout?.headerValue('x-company-id')).toBeNull();
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
    const meCalls = calls.filter((call) => call.url().endsWith('/auth/me/'));
    expect(meCalls.length).toBe(1); // no loop of session checks
  });

  test('server unreachable at startup: said plainly, with a retry', async ({ page }) => {
    await mockApi(page, { me: 'unreachable' });
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?raison=indisponible/);
    await expect(page.getByText('Le serveur ne répond pas.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  });
});
