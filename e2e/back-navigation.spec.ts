import { expect, test } from './support/fake-api';

/**
 * The back arrow before the breadcrumb: one level up, never the browser's history, never out
 * of the application.
 */
test.describe('Flèche de retour', () => {
  test('from an application’s first screen, back to the launcher', async ({ page }) => {
    await page.goto('/app/contacts/liste');
    await page.getByRole('link', { name: 'Retour à Applications' }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('from a record, back to its list as it was left (filters kept)', async ({ page }) => {
    await page.goto('/app/contacts/liste?q=diallo');
    await page.getByRole('link', { name: 'FOU-001', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Diallo et Cie');
    await page.getByRole('link', { name: /^Retour à / }).click();
    await expect(page).toHaveURL(/\/app\/contacts\/liste\?q=diallo$/);
    await expect(page.getByRole('searchbox', { name: 'Rechercher un contact' })).toHaveValue(
      'diallo',
    );
  });

  test('opened directly (reload, shared link), back to the parent screen', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await page.getByRole('link', { name: 'Retour à Écritures' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
