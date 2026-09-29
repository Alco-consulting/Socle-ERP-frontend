import { expect, test } from './support/fake-api';

test.describe('Vue liste : recherche, filtres, regroupement, favoris, pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures');
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('filters from the panel, shown as a removable criterion and kept in the URL', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Filtres' }).click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('État').selectOption({ label: 'Brouillon' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();

    await expect(page).toHaveURL(/etat=draft/);
    await expect(page.getByRole('button', { name: 'Filtres (1)' })).toBeFocused();
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toContainText('Brouillon');
    await expect(page.locator('tbody').getByText('Validée')).toHaveCount(0);

    await page.getByRole('button', { name: 'Retirer le critère État : Brouillon' }).click();
    await expect(page).not.toHaveURL(/etat=/);
  });

  test('Escape closes the filter panel and returns the focus', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Filtres' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Filtres' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Filtres' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('groups by journal with group headers and counts', async ({ page }) => {
    await page.getByRole('button', { name: 'Regrouper' }).click();
    await page.getByRole('menuitemradio', { name: 'Journal' }).click();
    await expect(page).toHaveURL(/groupe=journal/);
    await expect(page.getByRole('button', { name: /^ACH — Achats \(\d+\)$/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retirer le critère Regroupé par : Journal' }),
    ).toBeVisible();
  });

  test('a favorite applies a saved search', async ({ page }) => {
    await page.getByRole('button', { name: 'Favoris' }).click();
    await page.getByRole('menuitem', { name: 'Journal de banque' }).click();
    await expect(page).toHaveURL(/journal=BQ1/);
    await expect(
      page.getByRole('button', { name: 'Retirer le critère Journal : Banque principale' }),
    ).toBeVisible();
  });

  test('search without result explains and offers to reset', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Rechercher une écriture' }).fill('introuvable-xyz');
    await expect(page.getByText('Aucune écriture ne correspond à ces critères.')).toBeVisible();
    await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('sorts and pages on the server side', async ({ page }) => {
    await expect(page.getByText('1–20 sur 50')).toBeVisible();
    await page.getByRole('button', { name: 'Page suivante' }).click();
    await expect(page.getByText('21–40 sur 50')).toBeVisible();
    await page.getByRole('button', { name: /Montant/ }).click();
    await expect(page).toHaveURL(/tri=total%3Aasc|tri=total:asc/);
    await expect(page.getByText('1–20 sur 50')).toBeVisible();
  });

  test('selection reveals grouped actions, not fifteen buttons', async ({ page }) => {
    await page
      .getByRole('checkbox', { name: /^Sélectionner EC-/ })
      .first()
      .check();
    await expect(page.getByText('1 sélectionnée')).toBeVisible();
    await page.getByRole('button', { name: 'Actions sur la sélection' }).click();
    await expect(page.getByRole('menuitem', { name: 'Valider la sélection' })).toBeVisible();
  });
});
