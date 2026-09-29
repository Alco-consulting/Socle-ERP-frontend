import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';

const tiles = (page: Page) => page.locator('.tile-label');
const moduleNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Comptabilité' });
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Fil d’Ariane' });

async function openFromMore(page: Page, label: string) {
  await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
}

test.describe('Regroupement : peu d’applications, les domaines financiers dans Comptabilité', () => {
  test('the launcher shows no financial domain and no Import / Export tile', async ({
    page,
    api,
  }) => {
    api.withGlobalPermissions('users.read'); // administrator
    await page.goto('/');
    await expect(tiles(page)).toHaveText([
      'Comptabilité',
      'Tiers',
      'Reporting',
      'Documents',
      'Tableau de bord',
      'Paramètres',
    ]);
    for (const label of [
      'Trésorerie',
      'Immobilisations',
      'Emprunts',
      'Taxes',
      'Analytique',
      'Audit',
    ]) {
      await expect(tiles(page).filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(0);
    }
    await expect(page.getByText(/Imports? \/ Exports?/)).toHaveCount(0);
  });

  test('Trésorerie opens from Comptabilité, with its own navigation', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await moduleNav(page).getByRole('link', { name: 'Trésorerie' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tresorerie\/comptes$/);
    const sectionNav = page.getByRole('navigation', { name: 'Navigation Trésorerie' });
    await expect(sectionNav).toBeVisible();
    await sectionNav.getByRole('link', { name: 'Opérations' }).click();
    await expect(breadcrumb(page)).toHaveText(/Comptabilité\s*Trésorerie\s*Opérations/);
    await expect(moduleNav(page).getByRole('link', { name: 'Trésorerie' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opérations');
  });

  const FROM_MORE = [
    {
      label: 'Immobilisations',
      url: /\/app\/comptabilite\/immobilisations\/actifs$/,
      first: 'Actifs',
    },
    { label: 'Emprunts', url: /\/app\/comptabilite\/emprunts\/liste$/, first: 'Emprunts' },
    { label: 'Taxes', url: /\/app\/comptabilite\/taxes\/liste$/, first: 'Taxes' },
    { label: 'Analytique', url: /\/app\/comptabilite\/analytique\/axes$/, first: 'Axes' },
    { label: 'Audit', url: /\/app\/comptabilite\/audit\/journal$/, first: 'Journal d’audit' },
  ];
  for (const domain of FROM_MORE) {
    test(`${domain.label} opens from Comptabilité › Plus`, async ({ page }) => {
      await page.goto('/app/comptabilite/tableau-de-bord');
      await openFromMore(page, domain.label);
      await expect(page).toHaveURL(domain.url);
      await expect(breadcrumb(page)).toHaveText(
        new RegExp(String.raw`Comptabilité\s*${domain.label}\s*${domain.first}`),
      );
      await expect(breadcrumb(page).getByRole('link', { name: domain.label })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(domain.first);
      await expect(moduleNav(page).getByRole('button', { name: 'Plus' })).toBeVisible();
    });
  }

  test('Tiers is both an application (records) and a domain of Comptabilité (follow-up)', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await moduleNav(page).getByRole('link', { name: 'Tiers' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tiers\/clients$/);
    await expect(
      page
        .getByRole('navigation', { name: 'Navigation Tiers' })
        .getByRole('link', { name: 'Lettrage' }),
    ).toBeVisible();
  });
});

test.describe('Import / export contextuels', () => {
  test('import is started from Écritures and imports entries only', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures');
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Exporter les écritures/ })).toBeDisabled();
    await page.getByRole('menuitem', { name: 'Importer des écritures' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/import$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import d’écritures');
    await expect(breadcrumb(page)).toHaveText(/Comptabilité\s*Écritures\s*Import d’écritures/);
    await expect(
      page.getByRole('cell', { name: 'Clé de pièce (regroupe les lignes d’une écriture)' }),
    ).toBeVisible();
    // No generic choice of the object to import.
    await expect(page.getByText(/Quel objet|Choisir un type/)).toHaveCount(0);
  });

  test('export is started from Tiers and exports partners only', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Tiers/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tous les tiers');
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Exporter les tiers' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Exporter les tiers ?' });
    await expect(dialog).toContainText('tous les tiers');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('there is no Import / Export application or route', async ({ page }) => {
    await page.goto('/imports-exports');
    await expect(page.getByText('Cette page n’existe pas.')).toBeVisible();
    await page.goto('/app/comptabilite/tableau-de-bord');
    await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
    await expect(page.getByRole('menuitemradio', { name: /import|export/i })).toHaveCount(0);
  });

  test('a read-only profile has no import / export action', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto('/app/comptabilite/ecritures');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actions' })).toHaveCount(0);
  });
});

test.describe('Domaines selon la société (permissions données par le serveur)', () => {
  test('a services company does not see fixed assets, loans nor analytics', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await page.getByRole('button', { name: /Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
    for (const hidden of ['Immobilisations', 'Emprunts', 'Analytique']) {
      await expect(page.getByRole('menuitemradio', { name: hidden })).toHaveCount(0);
    }
    await expect(page.getByRole('menuitemradio', { name: 'Taxes' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/app/comptabilite/emprunts');
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(
      page.getByText('Cet écran n’est pas disponible pour votre profil ou pour cette société.'),
    ).toBeVisible();
  });
});
