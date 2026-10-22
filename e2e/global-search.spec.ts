import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';

/**
 * The global search (Ctrl+K) on the fake API: the screens of the menus, what can be created
 * and the records of the domains (contacts, accounts), within the user's permissions; the
 * keyboard alone reaches a screen.
 */

/** The top bar is drawn (the session known): Ctrl+K is listened to. */
async function searchReady(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Rechercher (Ctrl+K)' })).toBeVisible();
}

test.describe('Recherche globale (Ctrl+K)', () => {
  test('un écran au clavier, puis un contact par l’API', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog', { name: 'Recherche globale' });
    const field = palette.getByRole('combobox');
    await expect(field).toBeFocused();
    await expect(palette.getByRole('option', { name: /Nouvelle écriture/ })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('.cdk-overlay-container')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    // Accents and case do not matter; Entrée opens the first result.
    await field.fill('GRAND LIVRE');
    await expect(palette.getByRole('option').first()).toContainText('Grand livre');
    await expect(palette.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await field.press('Enter');
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/grand-livre$/);
    await expect(palette).toHaveCount(0);

    await page.getByRole('button', { name: 'Rechercher (Ctrl+K)' }).click();
    await palette.getByRole('combobox').fill('dupont');
    const contact = palette.getByRole('group', { name: 'Contacts' }).getByRole('option');
    await expect(contact.first()).toContainText('Dupont SARL');
    await contact.first().click();
    await expect(page).toHaveURL(/\/app\/contacts\/liste\/[\w-]+$/);
  });

  test('ArrowDown choisit ; rien ne correspond : le dire', async ({ page }) => {
    await page.goto('/app');
    await searchReady(page);
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog', { name: 'Recherche globale' });
    const field = palette.getByRole('combobox');
    await field.fill('balance');
    const options = palette.getByRole('option');
    await field.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await field.fill('zzzz introuvable');
    await expect(palette.getByText('Aucun résultat pour « zzzz introuvable ».')).toBeVisible();
    await field.press('Escape');
    await expect(palette).toHaveCount(0);
  });

  test('un profil en lecture : rien à créer', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto('/app');
    await searchReady(page);
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog', { name: 'Recherche globale' });
    await expect(palette.getByRole('group', { name: 'Applications' })).toBeVisible();
    await expect(palette.getByRole('group', { name: 'Créer' })).toHaveCount(0);
  });
});
