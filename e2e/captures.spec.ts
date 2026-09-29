import { Page, expect, test } from '@playwright/test';

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

  await page.goto('/comptabilite/tableau-de-bord');
  await shoot(page, '02-shell-dashboard', true);

  await page.goto('/comptabilite/tableau-de-bord');
  await page.getByRole('button', { name: 'Rapports' }).click();
  await shoot(page, '03-shell-navigation-menu');

  await page.goto('/comptabilite/ecritures');
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

  await page.goto('/comptabilite/ecritures?q=introuvable');
  await shoot(page, '07-state-empty');

  await page.goto('/comptabilite/ecritures/proto-050');
  await shoot(page, '08-form-draft', true);

  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shoot(page, '09-state-confirmation');
  await page.getByRole('button', { name: 'Valider l’écriture' }).click();
  await page.getByRole('button', { name: 'Comprendre l’erreur' }).click();
  await shoot(page, '10-state-error');

  await page.goto('/comptabilite/ecritures/proto-020');
  await shoot(page, '11-form-validated');

  await page.goto('/comptabilite/ecritures/nouvelle');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await shoot(page, '12-form-new-invalid', true);

  await page.goto('/design-system');
  await shoot(page, '13-design-system-catalog', true);

  await page.goto('/comptabilite/journaux');
  await shoot(page, '14-screen-not-in-prototype');
});

const moduleNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Comptabilité' });

test('regroupement: applications and domains of Comptabilité', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('Profil simulé').selectOption({ label: 'Administrateur' });
  await shoot(page, '40-launcher-administrator');
  await page.getByLabel('Profil simulé').selectOption({ label: 'Comptable' });

  await page.goto('/comptabilite/tableau-de-bord');
  await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
  await shoot(page, '41-accounting-more-menu');
  await page.keyboard.press('Escape');

  const domains: [string, string][] = [
    ['/comptabilite/tresorerie/comptes', '42-domain-treasury'],
    ['/comptabilite/emprunts/liste', '44-domain-loans'],
    ['/comptabilite/taxes/declarations', '45-domain-taxes'],
    ['/comptabilite/analytique/axes', '46-domain-analytics'],
    ['/comptabilite/audit/journal', '47-domain-audit'],
    ['/comptabilite/tiers/clients', '48-domain-partners-follow-up'],
  ];
  for (const [url, name] of domains) {
    await page.goto(url);
    await shoot(page, name);
  }

  await page.goto('/comptabilite/immobilisations/actifs');
  await page.getByRole('button', { name: 'Actions' }).click();
  await shoot(page, '43-domain-assets-actions');
  await page.keyboard.press('Escape');

  await page.goto('/comptabilite/ecritures');
  await page.getByRole('button', { name: 'Actions' }).click();
  await shoot(page, '50-entries-actions-import');
  await page.getByRole('menuitem', { name: 'Importer des écritures' }).click();
  await shoot(page, '51-entries-import', true);

  await page.goto('/tiers/liste');
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Exporter les tiers' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shoot(page, '52-partners-export');
  await page.keyboard.press('Escape');

  await page.goto('/comptabilite/tableau-de-bord');
  await page.getByRole('button', { name: /Société active/ }).click();
  await page.getByRole('menuitemradio', { name: /FILIALE SERVICES DÉMO SA/ }).click();
  await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
  await shoot(page, '53-services-company-more-menu');
});

test('loading state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/comptabilite/tableau-de-bord');
  await page
    .getByRole('navigation', { name: 'Navigation Comptabilité' })
    .getByRole('link', { name: 'Écritures' })
    .click();
  await page.screenshot({ path: `${OUT}/15-state-loading.png` });
});

test('permissions: read-only profile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('Profil simulé').selectOption({ label: 'Consultation' });
  await shoot(page, '16-launcher-read-only-profile');
});

test('tablet 820 × 1180', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  await shoot(page, '20-tablet-launcher');
  await page.goto('/comptabilite/tableau-de-bord');
  await shoot(page, '21-tablet-dashboard');
  await page.goto('/comptabilite/ecritures');
  await shoot(page, '22-tablet-list');
  await page.goto('/comptabilite/ecritures/proto-050');
  await shoot(page, '23-tablet-form', true);
  await page.goto('/comptabilite/tresorerie/operations');
  await moduleNav(page).getByRole('button', { name: 'Plus' }).click();
  await shoot(page, '24-tablet-compact-navigation');
});

test('phone 390 × 844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await shoot(page, '30-phone-launcher', true);
  await page.goto('/comptabilite/tableau-de-bord');
  await shoot(page, '31-phone-dashboard');
  await page.getByRole('button', { name: /^Navigation Comptabilité :/ }).click();
  await shoot(page, '32-phone-module-menu');
  await page.keyboard.press('Escape');
  await page.goto('/comptabilite/ecritures');
  await shoot(page, '33-phone-list');
  await page.goto('/comptabilite/ecritures/proto-050');
  await shoot(page, '34-phone-form', true);
});
