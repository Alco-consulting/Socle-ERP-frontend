import { Page } from '@playwright/test';

import { COMPANY_A, COMPANY_B, COMPANY_C, PROFILES, expect, test } from './support/fake-api';

/**
 * Screenshots for the design review (docs/frontend/captures). Not a test of behaviour:
 * run on demand with `npm run captures` (Playwright project « captures »).
 */
const OUT = '../docs/frontend/captures';

test.describe.configure({ mode: 'serial' });

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

test('desktop 1440 × 900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await shoot(page, '01-app-launcher');

  await page.goto('/app/comptabilite/tableau-de-bord');
  await shoot(page, '02-shell-dashboard', true);

  await page.goto('/app/comptabilite/tableau-de-bord');
  await page.getByRole('button', { name: 'Rapports' }).click();
  await shoot(page, '03-shell-navigation-menu');

  await page.goto('/app/comptabilite/ecritures');
  await shoot(page, '04-list');

  await page.getByRole('button', { name: 'Filtres' }).click();
  await page
    .getByRole('dialog', { name: 'Filtres' })
    .getByLabel('État')
    .selectOption({ label: 'Brouillon' });
  await shoot(page, '05-search-filters-panel');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await page.getByRole('button', { name: 'Regrouper' }).click();
  await page.getByRole('menuitemradio', { name: 'Journal' }).click();
  await shoot(page, '06-search-facets-grouped');

  await page.goto('/app/comptabilite/ecritures?q=introuvable');
  await shoot(page, '07-state-empty');

  await page.goto('/app/comptabilite/ecritures/proto-050');
  await shoot(page, '08-form-draft', true);

  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shoot(page, '09-state-confirmation');
  await page.getByRole('button', { name: 'Valider l’écriture' }).click();
  await page.getByRole('button', { name: 'Comprendre l’erreur' }).click();
  await shoot(page, '10-state-error');

  await page.goto('/app/comptabilite/ecritures/proto-020');
  await shoot(page, '11-form-validated');

  await page.goto('/app/comptabilite/ecritures/nouvelle');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await shoot(page, '12-form-new-invalid', true);

  await page.goto('/design-system');
  await shoot(page, '13-design-system-catalog', true);

  await page.goto('/app/comptabilite/journaux');
  await shoot(page, '14-screen-not-in-prototype');
});

const moduleNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Comptabilité' });

test('regroupement: applications and domains of Comptabilité', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  api.withGlobalPermissions('users.read'); // administrator
  await page.goto('/');
  await shoot(page, '40-launcher-administrator');
  api.withGlobalPermissions();

  await page.goto('/app/comptabilite/tableau-de-bord');
  await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
  await shoot(page, '41-accounting-more-menu');
  await page.keyboard.press('Escape');

  const domains: [string, string][] = [
    ['/app/comptabilite/tresorerie/comptes', '42-domain-treasury'],
    ['/app/comptabilite/emprunts/liste', '44-domain-loans'],
    ['/app/comptabilite/taxes/declarations', '45-domain-taxes'],
    ['/app/comptabilite/analytique/axes', '46-domain-analytics'],
    ['/app/comptabilite/audit/journal', '47-domain-audit'],
    ['/app/comptabilite/tiers/clients', '48-domain-partners-follow-up'],
  ];
  for (const [url, name] of domains) {
    await page.goto(url);
    await shoot(page, name);
  }

  await page.goto('/app/comptabilite/immobilisations/actifs');
  await page.getByRole('button', { name: 'Actions' }).click();
  await shoot(page, '43-domain-assets-actions');
  await page.keyboard.press('Escape');

  await page.goto('/app/comptabilite/ecritures');
  await page.getByRole('button', { name: 'Actions' }).click();
  await shoot(page, '50-entries-actions-import');
  await page.getByRole('menuitem', { name: 'Importer des écritures' }).click();
  await shoot(page, '51-entries-import', true);

  await page.goto('/app/tiers/liste');
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Exporter les tiers' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shoot(page, '52-partners-export');
  await page.keyboard.press('Escape');

  await page.goto('/app/comptabilite/tableau-de-bord');
  await page.getByRole('button', { name: /Société active/ }).click();
  await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
  await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
  await shoot(page, '53-services-company-more-menu');
});

test('loading state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/tableau-de-bord');
  await page
    .getByRole('navigation', { name: 'Navigation Comptabilité' })
    .getByRole('link', { name: 'Écritures' })
    .click();
  await page.screenshot({ path: `${OUT}/15-state-loading.png` });
});

test('permissions: read-only profile', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
  await page.goto('/');
  await shoot(page, '16-launcher-read-only-profile');
});

test('company context: choice, selector, switch', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  api.withCompanies(
    [
      { company: COMPANY_A, permissions: PROFILES.accountant },
      { company: COMPANY_B, permissions: PROFILES.services },
      { company: { ...COMPANY_C, status: 'inactive' }, permissions: PROFILES.viewer },
    ],
    null,
  );
  await page.goto('/app');
  await shoot(page, '60-company-choice');
  await page.getByRole('button', { name: /ALCO GUINÉE/ }).click();
  await page.getByRole('button', { name: /^Société active/ }).click();
  await shoot(page, '61-company-selector');
  api.slowContext(1500);
  await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/62-company-switching.png` });
  api.slowContext(0);
  await expect(page.getByRole('button', { name: /^Société active/ })).toContainText('FILIALE');
  await shoot(page, '63-launcher-after-switch');

  await page.setViewportSize({ width: 390, height: 844 });
  api.withCompanies(
    [
      { company: COMPANY_A, permissions: PROFILES.accountant },
      { company: COMPANY_B, permissions: PROFILES.services },
    ],
    null,
  );
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/app');
  await shoot(page, '64-phone-company-choice', true);
});

test('tablet 820 × 1180', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  await shoot(page, '20-tablet-launcher');
  await page.goto('/app/comptabilite/tableau-de-bord');
  await shoot(page, '21-tablet-dashboard');
  await page.goto('/app/comptabilite/ecritures');
  await shoot(page, '22-tablet-list');
  await page.goto('/app/comptabilite/ecritures/proto-050');
  await shoot(page, '23-tablet-form', true);
  await page.goto('/app/comptabilite/tresorerie/operations');
  await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
  await shoot(page, '24-tablet-compact-navigation');
});

test('phone 390 × 844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await shoot(page, '30-phone-launcher', true);
  await page.goto('/app/comptabilite/tableau-de-bord');
  await shoot(page, '31-phone-dashboard');
  await page.getByRole('button', { name: /^Navigation Comptabilité :/ }).click();
  await shoot(page, '32-phone-module-menu');
  await page.keyboard.press('Escape');
  await page.goto('/app/comptabilite/ecritures');
  await shoot(page, '33-phone-list');
  await page.goto('/app/comptabilite/ecritures/proto-050');
  await shoot(page, '34-phone-form', true);
});

test('tiers: list, record, form, import', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/tiers/liste');
  await shoot(page, '70-tiers-list');
  await page.goto(`/app/tiers/liste/${api.partners.list('A')[3].public_id}`);
  await shoot(page, '71-tiers-record', true);
  await page.goto('/app/tiers/nouveau');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await shoot(page, '72-tiers-form-invalid', true);
  await page.goto('/app/tiers/liste/import');
  await page.locator('input[type=file]').setInputFiles({
    name: 'nouveaux-tiers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(['Code,Nom,Pays', 'IMP-001,Import Un,GN', ',Sans nom,GN', ''].join('\n')),
  });
  await page.getByRole('button', { name: 'Envoyer et lire le fichier' }).click();
  await shoot(page, '73-tiers-import-mapping', true);
  await page.getByRole('button', { name: 'Contrôler les lignes' }).click();
  await shoot(page, '74-tiers-import-refused-rows', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/tiers/liste');
  await shoot(page, '75-phone-tiers-list');
});
