import { Page, expect, test } from '@playwright/test';

async function useProfile(page: Page, profile: 'Administrateur' | 'Comptable' | 'Consultation') {
  await page.goto('/');
  await page.getByLabel('Profil simulé').selectOption({ label: profile });
  await expect(page).toHaveURL(/\/app$/);
}

const tiles = (page: Page) => page.locator('.tile-label');
const moduleNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Comptabilité' });

test.describe('Affichage selon les permissions (confort d’interface ; l’API reste l’autorité)', () => {
  test('the launcher lists only the permitted applications', async ({ page }) => {
    await useProfile(page, 'Administrateur');
    await expect(tiles(page)).toHaveCount(6);
    await useProfile(page, 'Comptable');
    await expect(tiles(page)).toHaveText([
      'Comptabilité',
      'Tiers',
      'Reporting',
      'Documents',
      'Tableau de bord',
    ]);
    await useProfile(page, 'Consultation');
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Reporting', 'Tableau de bord']);
  });

  test('a read-only profile sees no creation action', async ({ page }) => {
    await useProfile(page, 'Consultation');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);
    await moduleNav(page).getByRole('link', { name: 'Écritures' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);
  });

  test('a forbidden application, screen or domain sends back with an explanation', async ({
    page,
  }) => {
    await useProfile(page, 'Consultation');
    await page.goto('/app/parametres');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByText('Vous n’avez pas accès à l’application Paramètres dans cette société.'),
    ).toBeVisible();

    await page.goto('/app/comptabilite/ecritures/nouvelle');
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/);
    await expect(page.getByText('Votre profil ne permet pas d’ouvrir cet écran.')).toBeVisible();

    await page.goto('/app/comptabilite/immobilisations/actifs');
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(
      page.getByText('Cet écran n’est pas disponible pour votre profil ou pour cette société.'),
    ).toBeVisible();
  });

  test('the module menu hides the domains of a missing permission', async ({ page }) => {
    await useProfile(page, 'Consultation');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(moduleNav(page).getByRole('link', { name: 'Trésorerie' })).toBeVisible();
    await expect(moduleNav(page).getByRole('link', { name: 'Tiers' })).toHaveCount(0);
    await expect(moduleNav(page).getByRole('button', { name: 'Rapports' })).toBeVisible();
    await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
    await expect(page.getByRole('menuitemradio')).toHaveText(['Taxes']);
  });
});
