import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';

const tiles = (page: Page) => page.locator('.tile-label');
const moduleNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Comptabilité' });
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Fil d’Ariane' });

/** Opens a menu of Comptabilité (« Analyse ▾ ») and returns its open menu. */
async function openMenu(page: Page, menu: string) {
  await moduleNav(page).getByRole('button', { name: menu, exact: true }).click();
  return page.getByRole('menu');
}

async function openFrom(page: Page, menu: string, label: string) {
  await (
    await openMenu(page, menu)
  )
    .getByRole('menuitemradio', { name: label, exact: true })
    .click();
}

test.describe('Lanceur : Reporting n’est plus une application', () => {
  test('exactly five applications, no Reporting, no financial domain nor Import / Export', async ({
    page,
    api,
  }) => {
    api.withGlobalPermissions('users.read'); // administrator
    await page.goto('/');
    await expect(tiles(page)).toHaveText([
      'Comptabilité',
      'Tiers',
      'Documents',
      'Tableau de bord',
      'Paramètres',
    ]);
    for (const label of [
      'Reporting',
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

  test('former Reporting URLs lead to Comptabilité › Analyse', async ({ page }) => {
    await page.goto('/app/reporting/balance');
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/balance$/);
    await expect(breadcrumb(page)).toHaveText(/Comptabilité\s*Balance générale/);
    await page.goto('/app/reporting');
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/balance$/);
    await page.goto('/app/comptabilite/rapports/grand-livre');
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/grand-livre$/);
    await page.goto('/app/comptabilite/tiers/clients');
    await expect(page).toHaveURL(/\/app\/comptabilite\/clients$/);
  });
});

test.describe('Comptabilité : trois liens et trois menus groupés', () => {
  test('Tableau de bord, Clients, Fournisseurs, then Comptabilité, Analyse, Configuration', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const full = moduleNav(page).locator('.entries--full > li');
    await expect(full).toHaveText([
      'Tableau de bord',
      'Clients',
      'Fournisseurs',
      /Comptabilité/,
      /Analyse/,
      /Configuration/,
    ]);
    await moduleNav(page).getByRole('link', { name: 'Clients' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/clients$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clients');
    await expect(page.getByRole('table')).toBeVisible();
    await moduleNav(page).getByRole('link', { name: 'Fournisseurs' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fournisseurs');
  });

  test('Comptabilité ▾: the eight functions, lettrage not presented as operational', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const menu = await openMenu(page, 'Comptabilité');
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      'Écritures',
      'Journaux',
      'Plan comptable',
      'Tiers',
      'Trésorerie',
      /Lettrage/,
      'Rapprochement',
      'Clôture',
    ]);
    const lettering = menu.getByRole('menuitemradio', { name: /Lettrage/ });
    await expect(lettering).toHaveAttribute('aria-disabled', 'true');
    await expect(lettering).toContainText('l’API ne propose pas le lettrage');
    await page.keyboard.press('Escape');
    await page.goto('/app/comptabilite/lettrage');
    await expect(page.getByText('Cette page n’existe pas.')).toBeVisible();
  });

  test('Analyse ▾: reports under announced titles', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const menu = await openMenu(page, 'Analyse');
    for (const [title, items] of [
      ['Rapports financiers', ['États financiers', 'Résultat']],
      ['Rapports comptables', ['Balance générale', 'Grand livre']],
      ['Rapports de tiers', ['Balance clients', 'Balance fournisseurs']],
      ['Analyses', ['Analytique', 'Immobilisations', 'Emprunts', 'Journal d’audit']],
    ] as const) {
      await expect(menu.getByRole('group', { name: title }).getByRole('menuitemradio')).toHaveText([
        ...items,
      ]);
    }
    await menu.getByRole('menuitemradio', { name: 'Balance générale' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/balance$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Balance générale');
    // The contextual export of the balance is offered there.
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Exporter la balance/ })).toBeVisible();
  });

  test('Configuration ▾: the configuration of every domain, grouped', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const menu = await openMenu(page, 'Configuration');
    const titles = menu.getByRole('group');
    await expect(titles).toHaveCount(8);
    for (const title of [
      'Général',
      'Comptabilité',
      'Banques',
      'Paiements',
      'Taxes',
      'Immobilisations',
      'Analytique',
      'Emprunts',
    ]) {
      await expect(menu.getByRole('group', { name: title, exact: true })).toBeVisible();
    }
    await menu
      .getByRole('group', { name: 'Paiements' })
      .getByRole('menuitemradio', { name: 'Conditions de paiement' })
      .click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/configuration\/conditions-paiement$/);
    await expect(page.getByText('Écran prévu, pas encore construit.')).toBeVisible();
  });

  test('Trésorerie opens from Comptabilité ▾, with its own navigation', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openFrom(page, 'Comptabilité', 'Trésorerie');
    await expect(page).toHaveURL(/\/app\/comptabilite\/tresorerie\/operations$/);
    const sectionNav = page.getByRole('navigation', { name: 'Navigation Trésorerie' });
    await expect(sectionNav).toBeVisible();
    await expect(breadcrumb(page)).toHaveText(/Comptabilité\s*Trésorerie\s*Opérations/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opérations');
  });

  const DOMAINS = [
    {
      menu: 'Analyse',
      label: 'Immobilisations',
      url: /\/app\/comptabilite\/immobilisations\/actifs$/,
      trail: 'Immobilisations\\s*Actifs',
    },
    {
      menu: 'Analyse',
      label: 'Emprunts',
      url: /\/app\/comptabilite\/emprunts\/liste$/,
      trail: 'Emprunts\\s*Emprunts',
    },
    {
      menu: 'Analyse',
      label: 'Journal d’audit',
      url: /\/app\/comptabilite\/audit\/journal$/,
      trail: 'Audit\\s*Journal d’audit',
    },
    {
      menu: 'Configuration',
      label: 'Axes',
      url: /\/app\/comptabilite\/analytique\/axes$/,
      trail: 'Analytique\\s*Axes',
    },
  ];
  for (const domain of DOMAINS) {
    test(`${domain.label} opens from Comptabilité › ${domain.menu}`, async ({ page }) => {
      await page.goto('/app/comptabilite/tableau-de-bord');
      await openFrom(page, domain.menu, domain.label);
      await expect(page).toHaveURL(domain.url);
      await expect(breadcrumb(page)).toHaveText(new RegExp(`Comptabilité\\s*${domain.trail}`));
    });
  }

  test('Tiers is an application (records) and a list of Comptabilité', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openFrom(page, 'Comptabilité', 'Tiers');
    await expect(page).toHaveURL(/\/app\/comptabilite\/tiers$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tiers');
    await page.getByRole('table').getByRole('link').first().click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tiers\/[^/]+$/);
    await expect(breadcrumb(page)).toHaveText(/Comptabilité\s*Tiers/);
  });
});

test.describe('Import / export contextuels', () => {
  test('import is started from Écritures and imports entries only', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures');
    await page.getByRole('button', { name: 'Actions' }).click();
    // The API V1 has no export of entries: not offered.
    await expect(page.getByRole('menuitem')).toHaveText(['Importer des écritures']);
    await page.getByRole('menuitem', { name: 'Importer des écritures' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/import$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import d’écritures');
    await expect(breadcrumb(page)).toHaveText(/Comptabilité\s*Écritures\s*Import d’écritures/);
    await expect(page.getByText('Crée des écritures en brouillon')).toBeVisible();
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

  test('there is no Import / Export application, route nor menu entry', async ({ page }) => {
    await page.goto('/imports-exports');
    await expect(page.getByText('Cette page n’existe pas.')).toBeVisible();
    await page.goto('/app/comptabilite/tableau-de-bord');
    for (const menu of ['Comptabilité', 'Analyse', 'Configuration']) {
      await openMenu(page, menu);
      await expect(page.getByRole('menuitemradio', { name: /import|export/i })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
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
    await openMenu(page, 'Configuration');
    for (const hidden of ['Immobilisations', 'Emprunts', 'Analytique']) {
      await expect(page.getByRole('group', { name: hidden, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('group', { name: 'Taxes', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/app/comptabilite/emprunts');
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(
      page.getByText('Cet écran n’est pas disponible pour votre profil ou pour cette société.'),
    ).toBeVisible();
  });
});
