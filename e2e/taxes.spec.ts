import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/**
 * Comptabilité › Configuration › Taxes, one simple screen, on the fake API: the list (name,
 * rate, where it applies, the account of each side, « Actif » switched from a row), the
 * usual taxes of Guinea in one click, and the page of a tax. Nothing reaches the real API.
 */

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map((violation) => violation.id);
}

test.describe('Taxes : un seul écran simple', () => {
  test('liste : nom, taux, côtés, comptes ; les taxes de Guinée en un clic', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Configuration', 'Taxes');
    await expect(page).toHaveURL(/\/app\/comptabilite\/taxes\/liste$/);
    await expect(page.locator('thead th')).toHaveText([
      'Nom',
      'Taux',
      'S’applique à',
      'Compte des ventes',
      'Compte des achats',
      'Actif',
    ]);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody tr').first()).toContainText('10 %');
    await expect(page.locator('tbody tr').first()).toContainText('retenue');

    await page.getByRole('button', { name: 'Créer les taxes de Guinée' }).click();
    await expect(page.getByText('3 taxes de Guinée créées.')).toBeVisible();
    await expect(page.locator('tbody a.code')).toHaveText([
      'Exonéré de TVA',
      'Retenue 10 %',
      'TVA 0 % export',
      'TVA 0 % import',
      'TVA 18 %',
    ]);
    // Again: nothing more is created.
    await page.getByRole('button', { name: 'Créer les taxes de Guinée' }).click();
    await expect(page.getByText('Les taxes de Guinée existent déjà.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('« Actif » se change depuis la ligne, par la commande', async ({ page, api }) => {
    await page.goto('/app/comptabilite/taxes/liste');
    const toggle = page.getByRole('switch', { name: 'Taxe TVA 18 % active' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText('Taxe TVA 18 % désactivée.')).toBeVisible();
    await expect(toggle).not.toBeChecked();
    expect(api.calls.some((call) => call.url().endsWith('/deactivate/'))).toBe(true);
  });

  test('création : une taxe de ventes n’a pas de compte des achats', async ({ page }) => {
    await page.goto('/app/comptabilite/taxes/liste');
    await page.getByRole('link', { name: 'Nouvelle taxe' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouvelle taxe');
    await page.locator('input[formcontrolname="name"]').fill('TVA 10 %');
    await page.getByLabel('Taux').fill('10');
    await expect(page.getByText('Compte des achats')).toBeVisible();
    await page.getByLabel('S’applique à').selectOption({ label: 'Ventes' });
    await expect(page.getByText('Compte des achats')).toHaveCount(0);
    await expect(page.getByText('Compte des ventes')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText('Taxe « TVA 10 % » créée.')).toBeVisible();
    await expect(page).toHaveURL(/\/taxes\/liste$/);
    await expect(page.getByRole('row', { name: /TVA 10 %/ })).toContainText('Ventes');
  });

  test('modification : le taux change sur la page de la taxe', async ({ page }) => {
    await page.goto('/app/comptabilite/taxes/liste');
    await page.getByRole('link', { name: 'TVA 18 %', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TVA 18 % · 18 %');
    await expect(page.getByLabel('Taux')).toHaveValue('18');
    await page.getByLabel('Taux').fill('20');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
    await expect(page.getByRole('row', { name: /TVA 18 %/ })).toContainText('20 %');
  });

  test('un nom déjà pris est dit sur le champ', async ({ page }) => {
    await page.goto('/app/comptabilite/taxes/liste/nouveau');
    await page.locator('input[formcontrolname="name"]').fill('TVA 18 %');
    await page.getByLabel('Taux').fill('18');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Une taxe de la société porte déjà ce nom.')).toBeVisible();
  });
});
