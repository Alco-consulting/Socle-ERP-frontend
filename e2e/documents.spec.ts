import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';

/**
 * Documents › Documents, on the fake API (`GET documents/`): the supporting documents of the
 * company with what they justify, searched and filtered through the API's parameters; an
 * empty result offers to reset. Nothing reaches the real API.
 */

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map((violation) => violation.id);
}

test.describe('Documents : les pièces justificatives de la société', () => {
  test('la liste, la recherche du serveur, le lien vers l’écriture justifiée', async ({
    page,
    api,
  }) => {
    await page.goto('/app');
    await page.getByRole('link', { name: /Documents/ }).click();
    await expect(page).toHaveURL(/\/app\/documents\/liste$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Documents');
    const names = page.locator('tbody .file-name');
    await expect(names).toHaveText(['releve-bicigui-mars.xlsx', 'facture-fournisseur-0042.pdf']);
    await expect(page.getByText('2 pièces')).toBeVisible();
    await expect(page.locator('tbody tr').last()).toContainText('Facture du fournisseur');
    await expect(page.locator('tbody tr').last()).toContainText('180 Ko');
    expect(await axe(page)).toEqual([]);

    await page.getByRole('searchbox', { name: 'Rechercher une pièce' }).fill('releve');
    await expect(names).toHaveText(['releve-bicigui-mars.xlsx']);
    await expect(page).toHaveURL(/q=releve/);
    const searched = api.calls.filter((call) => /\/documents\/\?.*search=releve/.test(call.url()));
    expect(searched.length).toBeGreaterThan(0);

    await page.getByRole('link', { name: 'Écriture' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/[\w-]+$/);
    await expect(
      page.getByRole('listitem').filter({ hasText: 'releve-bicigui-mars.xlsx' }),
    ).toBeVisible();
  });

  test('aucune pièce supprimée : le dire, et proposer de réinitialiser', async ({ page }) => {
    await page.goto('/app/documents/liste?etat=deleted');
    await expect(page.getByText('Aucune pièce ne correspond à ces critères.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Critères actifs' })).toContainText('Supprimées');
    await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
    await expect(page.locator('tbody .file-name')).toHaveCount(2);
  });
});
