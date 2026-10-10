import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/**
 * Comptabilité › Configuration › Devises, as Odoo shows them, on the fake API: the shared
 * catalogue (the active currencies first, « Actif » switched from a row by the holder of the
 * global `currencies.update`), and the page of a currency with its « Taux » in the company:
 * a rate added at once, a wrong one withdrawn. Nothing reaches the real API.
 */

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map((violation) => violation.id);
}

test.describe('Devises : comme dans Odoo', () => {
  test('liste : les actives d’abord, la dernière mise à jour et l’unité par GNF', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Configuration', 'Devises');
    await expect(page).toHaveURL(/\/app\/comptabilite\/configuration\/devises$/);
    await expect(page.locator('thead th')).toHaveText([
      'Devise',
      'Symbole',
      'Nom',
      'Dernière mise à jour',
      'Unité par GNF',
      'GNF par unité',
      'Actif',
    ]);
    await expect(page.locator('tbody a.code')).toHaveText([
      'EUR',
      'GNF',
      'USD',
      'XOF',
      'CHF',
      'CNY',
      'JPY',
    ]);
    const usd = page.getByRole('row', { name: /USD/ });
    await expect(usd).toContainText('01/10/2026');
    await expect(usd).toContainText('0,000115607');
    await expect(page.locator('tbody tr', { hasText: 'Franc guinéen' })).toContainText(
      'Devise de la société',
    );
    // Without the global currencies.update, « Actif » is read only.
    await expect(page.getByRole('switch', { name: 'Devise CHF active' })).toBeDisabled();
    expect(await axe(page)).toEqual([]);
  });

  test('« Actif » active une devise du catalogue ; celle de la société reste active', async ({
    page,
    api,
  }) => {
    api.withGlobalPermissions('currencies.create', 'currencies.update');
    await page.goto('/app/comptabilite/configuration/devises');
    await expect(page.getByRole('switch', { name: 'Devise GNF active' })).toBeDisabled();
    const chf = page.getByRole('switch', { name: 'Devise CHF active' });
    await expect(chf).not.toBeChecked();
    await chf.click();
    await expect(page.getByText('Devise CHF activée.')).toBeVisible();
    await expect(chf).toBeChecked();

    // Searched by name, filtered: the active francs.
    await page.getByRole('searchbox', { name: 'Rechercher une devise' }).fill('franc');
    await expect(page.locator('tbody a.code')).toHaveText(['CHF', 'GNF', 'XOF']);
  });

  test('page d’une devise : ses champs, puis « Taux » ; un taux ajouté, un autre retiré', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/configuration/devises');
    await page.getByRole('link', { name: 'USD', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('USD');
    await expect(page.getByLabel('Position du symbole')).toHaveValue('before');
    await expect(page.locator('input[formcontrolname="unit_label"]')).toHaveValue('Dollars');
    // The catalogue is global: read only without currencies.update.
    await expect(page.locator('input[formcontrolname="name"]')).toBeDisabled();

    await expect(page.getByRole('tab', { name: /Taux/ })).toBeVisible();
    const rates = page.locator('.rates tbody tr');
    await expect(rates).toHaveCount(2);
    await expect(rates.first()).toContainText('01/10/2026');
    await expect(rates.first()).toContainText('8 650');

    await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
    await page.getByLabel('Date').fill('2026-10-02');
    await page.getByLabel('GNF par unité').fill('8 700');
    await expect(page.getByText('Unité par GNF : 0,000114943')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Enregistrer le taux' }).click();
    await expect(page.getByText('Taux enregistré : 1 USD = 8 700 GNF.')).toBeVisible();
    await expect(rates).toHaveCount(3);
    await expect(rates.first()).toContainText('02/10/2026');

    // The same day again: refused, with its reason.
    await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
    await page.getByLabel('Date').fill('2026-10-02');
    await page.getByLabel('GNF par unité').fill('8 800');
    await page.getByRole('button', { name: 'Enregistrer le taux' }).click();
    await expect(
      page.getByText('Un taux existe déjà pour cette devise à cette date.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Annuler', exact: true }).last().click();

    // A wrong rate is withdrawn, after a confirmation.
    await page.getByRole('button', { name: 'Retirer le taux du 02/10/2026' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Retirer le taux' }).click();
    await expect(page.getByText('Taux retiré.')).toBeVisible();
    await expect(rates).toHaveCount(2);
  });

  test('devise inactive : « Activer la devise » depuis Taux, puis son taux', async ({
    page,
    api,
  }) => {
    api.withGlobalPermissions('currencies.create', 'currencies.update');
    await page.goto('/app/comptabilite/configuration/devises');
    await page.getByRole('link', { name: 'CHF', exact: true }).click();
    await expect(page.getByText('CHF est inactive')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Activer la devise' }).click();
    await expect(page.getByText('Devise CHF activée.')).toBeVisible();
    await expect(page.getByText('CHF est inactive')).toHaveCount(0);
    // The new rate's line is already open.
    await page.getByLabel('GNF par unité').fill('10 750');
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Enregistrer le taux' }).click();
    await expect(page.getByText('Taux enregistré : 1 CHF = 10 750 GNF.')).toBeVisible();
    await expect(page.locator('.rates tbody tr')).toHaveCount(1);
  });

  test('la devise de la société n’a pas de taux', async ({ page }) => {
    await page.goto('/app/comptabilite/configuration/devises');
    await page.getByRole('link', { name: 'GNF', exact: true }).click();
    await expect(page.getByText('GNF est la devise de la société')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toHaveCount(0);
  });

  test('nouvelle devise : code et décimales à la création, puis sa page', async ({ page, api }) => {
    api.withGlobalPermissions('currencies.create', 'currencies.update');
    await page.goto('/app/comptabilite/configuration/devises');
    await page.getByRole('link', { name: 'Nouvelle devise' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouvelle devise');
    await page.locator('input[formcontrolname="code"]').fill('xts');
    await page.locator('input[formcontrolname="name"]').fill('Devise de test');
    await page.getByLabel('Décimales').selectOption('3');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Devise XTS créée.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('XTS');
    await expect(page.locator('input[formcontrolname="code"]')).toBeDisabled();
    await expect(page.getByLabel('Décimales')).toBeDisabled();
    await expect(page.getByText('Aucun taux pour cette devise.')).toBeVisible();
  });
});
