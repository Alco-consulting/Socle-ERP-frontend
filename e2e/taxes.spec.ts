import AxeBuilder from '@axe-core/playwright';

import { expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/**
 * Comptabilité › Configuration › Taxes as Odoo's screens, on the fake API: the list (its
 * columns, « Ventes ou Achats », « Actif » switched from a row), a tax (its header, the
 * tabs « Définition » and « Options avancées ») and its form. Nothing reaches the real API.
 */
test.describe('Taxes comme dans Odoo', () => {
  test('liste : colonnes d’Odoo, « Ventes ou Achats », fiche et ses onglets', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Configuration', 'Taxes');
    await expect(page).toHaveURL(/\/app\/comptabilite\/taxes\/liste$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Taxes');
    await expect(page.locator('thead th')).toHaveText([
      'Nom de la taxe',
      'Description',
      'Type de taxe',
      'Portée de la taxe',
      'Libellé sur les factures',
      'Actif',
    ]);
    await expect(page.locator('tbody tr')).toHaveCount(7);
    await expect(
      page.getByRole('button', { name: 'Retirer le critère Type de taxe : Ventes ou Achats' }),
    ).toBeVisible();

    await page.getByRole('searchbox', { name: 'Rechercher une taxe' }).fill('importation');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('link', { name: '0% EX', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('0% EX');
    await expect(page.getByText('Répartition pour les factures')).toBeVisible();
    await expect(page.getByText('Répartition pour les notes de crédit')).toBeVisible();
    await page.getByRole('tab', { name: 'Options avancées' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('0% (importation)');
    await expect(page.getByRole('tabpanel')).toContainText('T.V.A. 0%');
  });

  test('« Actif » se change depuis la ligne, par la commande', async ({ page, api }) => {
    await page.goto('/app/comptabilite/taxes/liste');
    const toggle = page.getByRole('switch', { name: 'Taxe 18% G active' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText('Taxe 18% G désactivée.')).toBeVisible();
    await expect(toggle).not.toBeChecked();
    expect(api.calls.some((call) => call.url().endsWith('/deactivate/'))).toBe(true);
  });

  test('création : le formulaire d’Odoo, la fiche ensuite', async ({ page }) => {
    await page.goto('/app/comptabilite/taxes/liste');
    await page.getByRole('link', { name: 'Nouvelle taxe' }).click();
    await page.getByLabel('Nom de la taxe').fill('10% S');
    await page.getByLabel('Type de taxe').selectOption({ label: 'Achats' });
    await page.getByLabel('Montant').fill('10');
    const positions = page.getByLabel('Position fiscale');
    await positions.fill('National');
    await positions.press('Enter');
    await page.getByLabel('Grilles de taxes, ligne 2').first().fill('services_tax');
    await page.getByLabel('Grilles de taxes, ligne 2').first().press('Enter');
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText('Taxe « 10% S » créée.')).toBeVisible();
    await expect(page).toHaveURL(/\/taxes\/liste\/[\w-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('10% S');
    await expect(page.getByText('services_tax')).toBeVisible();
  });

  test('une répartition sans base : la raison du serveur', async ({ page }) => {
    await page.goto('/app/comptabilite/taxes/liste/nouveau');
    await page.getByLabel('Nom de la taxe').fill('Sans base');
    await page.getByRole('button', { name: 'Retirer la ligne 1' }).first().click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(
      page.getByText('La répartition pour les factures doit avoir exactement une ligne « Base ».'),
    ).toBeVisible();
  });

  test('accessibilité (axe) : liste, fiche, formulaire', async ({ page }) => {
    const violations = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((violation) => violation.id);
    await page.goto('/app/comptabilite/taxes/liste');
    await expect(page.locator('tbody tr')).toHaveCount(7);
    expect(await violations()).toEqual([]);
    await page.getByRole('link', { name: '18% G', exact: true }).click();
    await expect(page.getByText('Répartition pour les factures')).toBeVisible();
    expect(await violations()).toEqual([]);
    await page.getByRole('link', { name: 'Modifier' }).click();
    await expect(page.getByLabel('Nom de la taxe')).toHaveValue('18% G');
    expect(await violations()).toEqual([]);
    await page.getByRole('tab', { name: 'Options avancées' }).click();
    expect(await violations()).toEqual([]);
  });
});
