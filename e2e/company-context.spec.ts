import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { createEntry } from './support/entries';
import {
  COMPANY_A,
  COMPANY_B,
  COMPANY_C,
  PASSWORD,
  PROFILES,
  USER,
  expect,
  test,
} from './support/fake-api';

/**
 * The real company context (company-context/, X-Company-ID) in a real browser, against the
 * fake API: accessible companies, default one, choice, switch, permissions, launcher and
 * navigation, invalidation of the previous company's screens, refusals.
 */

const tiles = (page: Page) => page.locator('.tile-label');
const moduleNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Comptabilité' });
const companyButton = (page: Page) => page.getByRole('button', { name: /^Société active/ });

async function logIn(page: Page): Promise<void> {
  await page.getByLabel('Adresse e-mail').fill(USER.email);
  await page.getByRole('textbox', { name: 'Mot de passe', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

async function switchTo(page: Page, name: RegExp): Promise<void> {
  await companyButton(page).click();
  await page.getByRole('menuitemradio', { name }).click();
}

test.describe('Scénario 1 — société par défaut', () => {
  test('login → company A (default) → launcher → the applications of A', async ({ page, api }) => {
    api.signedOut();
    await page.goto('/');
    await logIn(page);
    await expect(page).toHaveURL(/\/app$/);
    await expect(companyButton(page)).toHaveAccessibleName(
      'Société active : ALCO GUINÉE (test). Changer de société',
    );
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Tiers', 'Documents', 'Tableau de bord']);
    await expect(page.getByText('ALCO GUINÉE (test) · 4 applications disponibles')).toBeVisible();
    const [context] = api.callsTo('company-context/');
    expect(await context.headerValue('x-company-id')).toBeNull(); // the server's default
  });
});

test.describe('Scénario 2 — aucune société par défaut : l’utilisateur choisit', () => {
  test('login → choice → company B → the applications of B, B by default next time', async ({
    page,
    api,
  }) => {
    api.signedOut().withCompanies(
      [
        { company: COMPANY_A, permissions: PROFILES.accountant },
        { company: COMPANY_B, permissions: ['accounting.read', 'reporting.read'] },
      ],
      null,
    );
    await page.goto('/app/comptabilite/ecritures/pieces');
    await logIn(page);

    await expect(page).toHaveURL(/\/societe\?retour=%2Fapp%2Fcomptabilite%2Fecritures%2Fpieces$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choisissez une société');
    const list = page.getByRole('list', { name: 'Sociétés accessibles' });
    await expect(list.getByRole('button')).toHaveCount(2);
    await page.getByLabel('Ouvrir directement cette société à mes prochaines connexions').check();
    await list.getByRole('button', { name: /FILIALE SÉNÉGAL \(test\)/ }).click();

    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/pieces$/);
    await expect(companyButton(page)).toContainText('FILIALE SÉNÉGAL (test)');
    const choice = api.callsTo('company-context/').at(-1);
    expect(await choice?.headerValue('x-company-id')).toBe(COMPANY_B.public_id);
    const [makeDefault] = api.callsTo('company-context/default/');
    expect(makeDefault.method()).toBe('PUT');
    expect(makeDefault.postDataJSON()).toEqual({ company: COMPANY_B.public_id });

    await page.getByRole('link', { name: 'Toutes les applications' }).click();
    await expect(tiles(page)).toHaveText(['Comptabilité']);
  });

  test('the choice screen: accessible, fits a phone', async ({ page, api }) => {
    api.withCompanies(
      [
        { company: COMPANY_A, permissions: PROFILES.accountant },
        { company: COMPANY_B, permissions: PROFILES.viewer },
      ],
      null,
    );
    await page.goto('/app');
    await expect(page).toHaveURL(/\/societe/);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a single company and no default: opened directly, no choice to make', async ({
    page,
    api,
  }) => {
    api.withCompanies([{ company: COMPANY_C, permissions: PROFILES.viewer }], null);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app$/);
    await expect(companyButton(page)).toContainText('ALCO MALI (test)');
  });

  test('no accessible company: said plainly, with a way out', async ({ page, api }) => {
    api.withCompanies([], null);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/societe/);
    await expect(page.getByText('Aucune société accessible.')).toBeVisible();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login\?raison=deconnexion$/);
  });
});

test.describe('Scénario 3 — changement de société', () => {
  test('context, navigation and data follow; nothing of the previous company stays', async ({
    page,
    api,
  }) => {
    // A draft in company A (the fake books follow X-Company-ID, like the server).
    await createEntry(page, {
      date: '2026-06-28',
      description: 'Achat propre à la société A',
      lines: [
        ['601', 'Débit', '1000'],
        ['401', 'Crédit', '1000'],
      ],
    });
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page.getByRole('cell', { name: /Achat propre à la société A/ })).toBeVisible();

    // Switch to B (a services company) from the screen: slow answer, so that the
    // intermediate state is visible.
    api.slowContext(400);
    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(page.getByText('Changement de société…')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0); // A's list is gone at once
    await expect(companyButton(page)).toContainText('FILIALE SÉNÉGAL (test)');

    // Same menu screen, without A's filters; B's books.
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/pieces$/);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText(/Achat propre à la société A/)).toHaveCount(0);
    await expect(page.locator('#contenu')).toBeFocused();
    await expect(page.getByText('Société active : FILIALE SÉNÉGAL (test).')).toBeVisible();
    const switchCall = api.callsTo('company-context/').at(-1);
    expect(await switchCall?.headerValue('x-company-id')).toBe(COMPANY_B.public_id);

    // Navigation recomputed with B's permissions.
    await moduleNav(page).getByRole('button', { name: 'Configuration', exact: true }).click();
    for (const hidden of ['Immobilisations', 'Emprunts', 'Analytique']) {
      await expect(page.getByRole('group', { name: hidden, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('group', { name: 'Taxes', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Back to A: its draft is there again (the server kept it).
    api.slowContext(0);
    await switchTo(page, /ALCO GUINÉE/);
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/pieces$/);
    await expect(page.getByRole('cell', { name: /Achat propre à la société A/ })).toBeVisible();
  });

  test('a record of the previous company is never kept: back to its list', async ({
    page,
    api,
  }) => {
    const validated = api.entries.entries('A').find((item) => item.status === 'validated');
    await page.goto(`/app/comptabilite/ecritures/${validated?.public_id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(validated!.entry_number);
    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures comptables');
  });

  test('a screen closed in the new company: the home of the application', async ({ page }) => {
    await page.goto('/app/comptabilite/immobilisations/actifs');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Actifs');
    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
  });

  test('an application closed in the new company: the launcher', async ({ page, api }) => {
    api.withPermissions(COMPANY_B.public_id, PROFILES.viewer); // no partners.read in B
    await page.goto('/app/tiers/liste');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tous les tiers');
    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(page).toHaveURL(/\/app$/);
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Tableau de bord']);
  });

  test('a reload stays in the company chosen in this tab', async ({ page, api }) => {
    await page.goto('/app');
    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(companyButton(page)).toContainText('FILIALE SÉNÉGAL (test)');
    await page.reload();
    await expect(companyButton(page)).toContainText('FILIALE SÉNÉGAL (test)');
    const reloadCall = api.callsTo('company-context/').at(-1);
    expect(await reloadCall?.headerValue('x-company-id')).toBe(COMPANY_B.public_id);
  });

  test('the company selector: keyboard and screen reader', async ({ page }) => {
    await page.goto('/app');
    await companyButton(page).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio', { name: /ALCO GUINÉE/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(companyButton(page)).toContainText('FILIALE SÉNÉGAL (test)');
    await expect(page.locator('#contenu')).toBeFocused();
  });
});

test.describe('Scénario 4 — application ou écran interdit', () => {
  test('an application hidden in the launcher stays closed through its URL', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto('/app');
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Tableau de bord']);
    await page.goto('/app/tiers/liste');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByText('Vous n’avez pas accès à l’application Tiers dans cette société.'),
    ).toBeVisible();
  });

  test('a global grant never opens a company domain (platform administrator)', async ({
    page,
    api,
  }) => {
    // Django gives a superuser every permission in auth/me/; in a company it has no
    // membership grant, the server gives only the company management ones.
    api
      .withGlobalPermissions('accounting.read', 'partners.read', 'users.read', 'companies.create')
      .withPermissions(COMPANY_A.public_id, ['companies.read', 'companies.manage_members']);
    await page.goto('/app');
    await expect(tiles(page)).toHaveText(['Paramètres']);
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/parametres');
    await expect(page).toHaveURL(/\/app\/parametres\/societe$/);
    const nav = page.getByRole('navigation', { name: 'Navigation Paramètres' });
    await expect(nav.getByRole('link')).toHaveText(['Société', 'Utilisateurs', 'Rôles et droits']);
  });
});

test.describe('Scénario 5 — société devenue inaccessible', () => {
  test('choosing it: said, the list refreshed, the current company kept', async ({ page, api }) => {
    api.withCompanies(
      [
        { company: COMPANY_A, permissions: PROFILES.accountant },
        { company: COMPANY_C, permissions: PROFILES.viewer },
      ],
      COMPANY_A.public_id,
    );
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page.getByRole('table')).toBeVisible();
    api.revoke(COMPANY_C.public_id); // membership ended meanwhile

    await switchTo(page, /ALCO MALI/);
    await expect(
      page.getByText('La société sélectionnée n’est plus accessible.', { exact: false }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/pieces$/);
    await expect(companyButton(page)).toContainText('ALCO GUINÉE (test)');
    await expect(page.getByRole('table')).toBeVisible();
    await companyButton(page).click();
    await expect(page.getByRole('menuitemradio')).toHaveCount(1);
  });

  test('the company of this tab refused at a reload: back to a valid one', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(companyButton(page)).toContainText('FILIALE SÉNÉGAL (test)');
    api.revoke(COMPANY_B.public_id);

    await page.reload();
    await expect(
      page.getByText('La société sélectionnée n’est plus accessible.', { exact: false }),
    ).toBeVisible();
    await expect(companyButton(page)).toContainText('ALCO GUINÉE (test)');
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/pieces$/);
  });
});
