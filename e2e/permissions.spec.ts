import { Page } from '@playwright/test';

import { COMPANY_A, FakeApi, PROFILES, expect, test } from './support/fake-api';
import { moduleNav, openMenuItem } from './support/navigation';

/** The permissions the server gives in company A (`users.read` is global: `auth/me/`). */
async function useProfile(
  page: Page,
  api: FakeApi,
  profile: 'administrator' | 'accountant' | 'viewer',
) {
  api
    .withGlobalPermissions(...(profile === 'administrator' ? ['users.read'] : []))
    .withPermissions(COMPANY_A.public_id, PROFILES[profile === 'viewer' ? 'viewer' : 'accountant']);
  await page.goto('/');
  await expect(page).toHaveURL(/\/app$/);
}

const tiles = (page: Page) => page.locator('.tile-label');

test.describe('Affichage selon les permissions (confort d’interface ; l’API reste l’autorité)', () => {
  test('the launcher lists only the permitted applications', async ({ page, api }) => {
    await useProfile(page, api, 'administrator');
    await expect(tiles(page)).toHaveCount(5);
    await useProfile(page, api, 'accountant');
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Tiers', 'Documents', 'Tableau de bord']);
    await useProfile(page, api, 'viewer');
    // reporting.read opens Comptabilité › Analyse, no application of its own.
    await expect(tiles(page)).toHaveText(['Comptabilité', 'Tableau de bord']);
  });

  test('a read-only profile sees no creation action', async ({ page, api }) => {
    await useProfile(page, api, 'viewer');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);
    await openMenuItem(page, 'Comptabilité', 'Écritures');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);
  });

  test('a forbidden application, screen or domain sends back with an explanation', async ({
    page,
    api,
  }) => {
    await useProfile(page, api, 'viewer');
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

  test('the module menu hides the domains of a missing permission', async ({ page, api }) => {
    await useProfile(page, api, 'viewer');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    // No partners.read: neither Clients nor Fournisseurs nor Tiers.
    await expect(moduleNav(page).getByRole('link', { name: 'Clients' })).toHaveCount(0);
    await moduleNav(page).getByRole('button', { name: 'Comptabilité', exact: true }).click();
    await expect(page.getByRole('menu').getByRole('menuitemradio')).toHaveText([
      'Écritures',
      'Journaux',
      'Plan comptable',
      'Trésorerie',
      /Lettrage/,
      'Rapprochement',
    ]);
    await page.keyboard.press('Escape');
    // reporting.read only: the accounting reports, not the others.
    await moduleNav(page).getByRole('button', { name: 'Analyse', exact: true }).click();
    await expect(page.getByRole('menu').getByRole('menuitemradio')).toHaveText([
      'Balance générale',
      'Grand livre',
    ]);
    await page.keyboard.press('Escape');
    await moduleNav(page).getByRole('button', { name: 'Configuration', exact: true }).click();
    await expect(page.getByRole('menu').getByRole('group')).toHaveText([
      /^\s*Général/,
      /^\s*Comptabilité/,
      /^\s*Banques/,
      /^\s*Taxes/,
    ]);
  });
});
