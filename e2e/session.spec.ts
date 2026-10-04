import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_B, PASSWORD, THROTTLED, USER, expect, test } from './support/fake-api';

/**
 * Login, Django session and CSRF in a real browser, against the fake API
 * (e2e/support/fake-api.ts): no real account, nothing reaches the deployed API.
 */

const ACCOUNTANT_TILES = ['Comptabilité', 'Tiers', 'Documents', 'Tableau de bord'];

const tiles = (page: Page) => page.locator('.tile-label');

async function logIn(page: Page, email = USER.email, password = PASSWORD): Promise<void> {
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test.describe('Connexion', () => {
  test('login → session → company context → App Launcher; still connected after a refresh', async ({
    page,
    api,
  }) => {
    api.signedOut();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?retour=%2Fapp$/);
    await expect(page.getByLabel('Adresse e-mail')).toBeFocused();
    await logIn(page);

    await expect(page).toHaveURL(/\/app$/);
    await expect(tiles(page)).toHaveText(ACCOUNTANT_TILES);
    const [csrfCall] = api.callsTo('auth/csrf/');
    const [login] = api.callsTo('auth/login/');
    expect(api.calls.indexOf(csrfCall)).toBeLessThan(api.calls.indexOf(login));
    expect(login.postDataJSON()).toEqual({ email: USER.email, password: PASSWORD });
    expect(await login.headerValue('x-xsrf-token')).toBe('tok-e2e');
    expect(await login.headerValue('x-company-id')).toBeNull();
    expect(api.callsTo('auth/me/').length).toBe(1); // only the start check

    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(tiles(page)).toHaveText(ACCOUNTANT_TILES);
  });

  test('back to the page asked before login', async ({ page, api }) => {
    api.signedOut();
    await page.goto('/app/comptabilite/ecritures');
    await logIn(page);
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures');
  });

  test('an external return address is never followed', async ({ page, api }) => {
    api.signedOut();
    await page.goto('/login?retour=https%3A%2F%2Fevil.example%2F');
    await logIn(page);
    await expect(page).toHaveURL(/localhost:\d+\/app$/);
  });

  test('wrong credentials: human message, password cleared and focused', async ({ page, api }) => {
    api.signedOut();
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

  test('rate limit (429): message and wait from Retry-After', async ({ page, api }) => {
    api.signedOut();
    await page.goto('/login');
    await logIn(page, THROTTLED, 'whatever');
    await expect(page.getByRole('alert')).toContainText('Trop de tentatives.');
    await expect(page.getByRole('alert')).toContainText('30 secondes');
    const button = page.getByRole('button', { name: /Réessayez dans \d+ s/ });
    await expect(button).toBeDisabled();
  });

  test('double click: one login request', async ({ page, api }) => {
    api.signedOut().slowLogin(600);
    await page.goto('/login');
    await page.getByLabel('Adresse e-mail').fill(USER.email);
    await page.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).dblclick();
    await expect(page.getByRole('button', { name: 'Connexion en cours…' })).toBeDisabled();
    await expect(page).toHaveURL(/\/app$/);
    expect(api.callsTo('auth/login/').length).toBe(1);
  });

  test('nothing sensitive is stored by the front end', async ({ page, api }) => {
    api.signedOut();
    await page.goto('/login');
    await logIn(page);
    await expect(tiles(page)).toHaveCount(ACCOUNTANT_TILES.length);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored).not.toContain(PASSWORD);
    expect(stored.toLowerCase()).not.toMatch(/token|sessionid|jwt|password/);
  });

  test('login screen: no accessibility violation, error announced, fits a phone', async ({
    page,
    api,
  }) => {
    api.signedOut();
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
    await page.goto('/login');
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('Session Django et CSRF', () => {
  test('an anonymous visitor goes to the login screen, with the page to come back to', async ({
    page,
    api,
  }) => {
    api.signedOut();
    await page.goto('/app/comptabilite/ecritures');
    await expect(page).toHaveURL(/\/login\?retour=%2Fapp%2Fcomptabilite%2Fecritures$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion');
    await expect(page.getByRole('note', { name: 'Démonstration' })).toHaveCount(0);
  });

  test('the session comes from the API, without any token', async ({ page, api }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText('Bonjour Mariam')).toBeVisible();
    const [me] = api.callsTo('auth/me/');
    expect(await me.headerValue('x-company-id')).toBeNull();
    expect(await me.headerValue('authorization')).toBeNull(); // the session is a cookie
  });

  test('logout: CSRF cookie fetched then sent; the session is closed on the server', async ({
    page,
    api,
  }) => {
    await page.goto('/app');
    await expect(tiles(page)).toHaveCount(ACCOUNTANT_TILES.length);
    await page.getByRole('button', { name: /Compte de Mariam Test/ }).click();
    await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login\?raison=deconnexion$/);
    await expect(page.getByText('Vous êtes déconnecté.')).toBeVisible();
    const [csrfCall] = api.callsTo('auth/csrf/');
    const [logout] = api.callsTo('auth/logout/');
    expect(api.calls.indexOf(csrfCall)).toBeLessThan(api.calls.indexOf(logout));
    expect(logout.method()).toBe('POST');
    expect(await logout.headerValue('x-xsrf-token')).toBe('tok-e2e');
    expect(await logout.headerValue('x-company-id')).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('alco.company'))).toBeNull();

    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?retour=%2Fapp$/);
  });

  test('a session ending during work: back to the login screen, once, with the reason', async ({
    page,
    api,
  }) => {
    api.expireOn(COMPANY_B.public_id);
    await page.goto('/app');
    await expect(tiles(page)).toHaveCount(ACCOUNTANT_TILES.length);
    await page.getByRole('button', { name: /Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(/\/login\?raison=session-expiree&retour=%2Fapp$/);
    await expect(page.getByText('Votre session a expiré.', { exact: false })).toBeVisible();
    expect(api.callsTo('auth/me/').length).toBe(1); // no loop of session checks

    // Logging in again resumes where the user was.
    await logIn(page);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('server unreachable at startup: said plainly, with a retry', async ({ page, api }) => {
    api.serverDown();
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?raison=indisponible/);
    await expect(page.getByText('Le serveur ne répond pas.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  });
});
