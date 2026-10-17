import { expect, test } from './support/fake-api';

/** The list view of the design system, on real screens of the API (fake server). */
test.describe('Vue liste : filtres, regroupement, recherche, état dans l’URL', () => {
  test('the filter panel: counted criteria, reset, Escape returns the focus', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page.getByRole('table')).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Filtres' });
    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('État').selectOption({ label: 'Brouillon' });
    await panel.getByLabel('Du').fill('2026-03-01');
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/etat=draft/);
    await expect(page).toHaveURL(/du=2026-03-01/);
    await expect(page.getByRole('button', { name: 'Filtres (2)' })).toBeFocused();
    await expect(page.locator('tbody').getByText('Validée')).toHaveCount(0);

    await page.getByRole('button', { name: 'Filtres (2)' }).click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Filtres (2)' })).toBeFocused();

    await page.getByRole('button', { name: 'Filtres (2)' }).click();
    await panel.getByRole('button', { name: 'Réinitialiser' }).click();
    await expect(page).not.toHaveURL(/etat=|du=/);
  });

  test('groups by code group with group headers and counts (chart of accounts)', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    await page.getByRole('button', { name: 'Regrouper' }).click();
    await page.getByRole('menuitemradio', { name: 'Groupe', exact: true }).click();
    await expect(page).toHaveURL(/groupe=groupe/);
    await expect(page.getByRole('button', { name: /^Groupe 40 \(\d+\)$/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retirer le critère Regroupé par : Groupe' }),
    ).toBeVisible();
  });

  test('a search without result explains and offers to reset (Tiers)', async ({ page }) => {
    await page.goto('/app/contacts/liste');
    await page.getByRole('searchbox', { name: 'Rechercher un contact' }).fill('introuvable-xyz');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Aucun contact ne correspond à ces critères.')).toBeVisible();
    await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('pages come from the server; back keeps the page', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page.getByText(/1–25\s*sur\s*48/)).toBeVisible();
    await page.getByRole('button', { name: 'Page suivante' }).click();
    await expect(page.getByText(/26–48\s*sur\s*48/)).toBeVisible();
    await page.locator('tbody a').first().click();
    await expect(page).toHaveURL(/\/ecritures\/[\w-]+$/);
    await page.goBack();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/26–48\s*sur\s*48/)).toBeVisible();
  });
});
