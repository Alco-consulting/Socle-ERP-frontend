import { expect, test } from './support/fake-api';

const breadcrumb = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Fil d’Ariane' });

test.describe('Parcours App Launcher → Comptabilité → Écritures → Formulaire → Retour', () => {
  test('the whole journey, with breadcrumbs, module navigation and back', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Sélectionnez une application',
    );
    await expect(page).toHaveTitle('Applications · Alco');

    // Launcher → application
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(breadcrumb(page)).toContainText('Comptabilité');
    await expect(breadcrumb(page)).toContainText('Tableau de bord');
    const moduleNav = page.getByRole('navigation', { name: 'Navigation Comptabilité' });
    await expect(moduleNav.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Dashboard → list through the module navigation (Comptabilité ▾ › Écritures)
    await moduleNav.getByRole('button', { name: 'Comptabilité', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Écritures', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures comptables');
    await expect(page).toHaveTitle('Écritures · Comptabilité · Alco');
    await expect(page.getByRole('table')).toBeVisible();

    // List → record (a validated entry: numbered by the server)
    const first = page.getByRole('link', { name: /^[A-Z0-9]+-\d{6}$/ }).first();
    const number = (await first.textContent())!.trim();
    await first.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(number);
    await expect(breadcrumb(page)).toContainText('Écritures');
    await expect(breadcrumb(page).getByText(number)).toHaveAttribute('aria-current', 'page');

    // Back (browser) keeps the list
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures comptables');

    // Breadcrumb → application home
    await breadcrumb(page).getByRole('link', { name: 'Comptabilité' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);

    // Apps button → launcher
    await page.getByRole('link', { name: 'Toutes les applications' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('a bookmark of an application or a section opens its first screen', async ({ page }) => {
    // The home depends on the permissions: computed once the session is loaded.
    await page.goto('/app/comptabilite');
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await page.goto('/app/comptabilite/tresorerie');
    // Its first screen: « Transactions » (note backend 0044).
    await expect(page).toHaveURL(/\/app\/comptabilite\/tresorerie\/transactions$/);
  });

  test('a secondary screen of the menu opens and says it is not built yet', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await page.getByRole('button', { name: 'Analyse', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Balance générale' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/balance$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Balance générale');
    await expect(page.getByText('Écran prévu, pas encore construit.')).toBeVisible();
  });

  test('the skip link moves the focus to the content', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pièces comptables');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#contenu')).toBeFocused();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/pieces$/);
  });

  test('an unknown address shows a useful page', async ({ page }) => {
    await page.goto('/nimporte-quoi');
    await expect(page.getByText('Cette page n’existe pas.')).toBeVisible();
    await page.getByRole('link', { name: 'Revenir aux applications' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });
});
