import { Page, expect, test } from '@playwright/test';

async function useProfile(page: Page, profile: 'Administrateur' | 'Comptable' | 'Consultation') {
  await page.goto('/');
  await page.getByLabel('Profil simulé').selectOption({ label: profile });
  await expect(page).toHaveURL(/\/$/);
}

const tiles = (page: Page) => page.locator('.tile-label');

test.describe('Affichage selon les permissions (confort d’interface ; l’API reste l’autorité)', () => {
  test('the launcher lists only the permitted applications', async ({ page }) => {
    await useProfile(page, 'Administrateur');
    await expect(tiles(page)).toHaveCount(13);
    await useProfile(page, 'Comptable');
    await expect(tiles(page)).toHaveCount(12);
    await expect(tiles(page).filter({ hasText: 'Paramètres' })).toHaveCount(0);
    await useProfile(page, 'Consultation');
    await expect(tiles(page)).toHaveText([
      'Comptabilité',
      'Tiers',
      'Reporting',
      'Documents',
      'Tableau de bord',
    ]);
  });

  test('a read-only profile sees no creation action, and the empty state adapts', async ({
    page,
  }) => {
    await useProfile(page, 'Consultation');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Navigation Comptabilité' })
      .getByRole('link', { name: 'Écritures' })
      .click();
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);
  });

  test('a forbidden application or screen sends back with an explanation', async ({ page }) => {
    await useProfile(page, 'Consultation');
    await page.goto('/tresorerie');
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText('Vous n’avez pas accès à l’application Trésorerie dans cette société.'),
    ).toBeVisible();

    await page.goto('/comptabilite/ecritures/nouvelle');
    await expect(page).toHaveURL(/\/comptabilite\/ecritures$/);
    await expect(page.getByText('Votre profil ne permet pas d’ouvrir cet écran.')).toBeVisible();
  });

  test('the module menu hides the entries of a missing permission', async ({ page }) => {
    await useProfile(page, 'Consultation');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    const nav = page.getByRole('navigation', { name: 'Navigation Comptabilité' });
    await expect(nav.getByRole('button', { name: 'Rapports' })).toBeVisible();
    await nav.getByRole('button', { name: 'Plus' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Clôture' })).toHaveCount(0);
    await expect(page.getByRole('menuitemradio', { name: 'Lettrage' })).toBeVisible();
  });
});
