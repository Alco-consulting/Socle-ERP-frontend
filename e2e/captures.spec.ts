import { Page } from '@playwright/test';

import { createEntry, fillEntry } from './support/entries';
import { COMPANY_A, COMPANY_B, COMPANY_C, PROFILES, expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

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

test('desktop 1440 × 900', async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await shoot(page, '01-app-launcher');

  await page.goto('/app/comptabilite/tableau-de-bord');
  await shoot(page, '02-shell-dashboard', true);

  await page.goto('/app/comptabilite/tableau-de-bord');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
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
  await page.goto('/app/comptabilite/plan-comptable?groupe=classe');
  await shoot(page, '06-search-facets-grouped');

  await page.goto('/app/comptabilite/ecritures?compte=999');
  await shoot(page, '07-state-empty');

  const draft = api.entries.entries('A').find((item) => item.status === 'draft');
  await page.goto(`/app/comptabilite/ecritures/${draft?.public_id}`);
  await shoot(page, '08-form-draft', true);

  await page.locator('alco-page-header').getByRole('button', { name: 'Soumettre' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shoot(page, '09-state-confirmation');
  await page.keyboard.press('Escape');

  await page.goto('/app/comptabilite/ecritures/nouvelle');
  await fillEntry(page, {
    date: '2026-02-10',
    description: 'Achat de février',
    lines: [
      ['601', 'Débit', '1000'],
      ['401', 'Crédit', '1000'],
    ],
  });
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('La période de cette date est clôturée.').first()).toBeVisible();
  await shoot(page, '10-state-error', true);

  const validated = api.entries.entries('A').find((item) => item.status === 'validated');
  await page.goto(`/app/comptabilite/ecritures/${validated?.public_id}`);
  await shoot(page, '11-form-validated', true);

  await page.goto('/app/comptabilite/ecritures/nouvelle');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await shoot(page, '12-form-new-invalid', true);

  await page.goto('/design-system');
  await shoot(page, '13-design-system-catalog', true);

  await page.goto('/app/comptabilite/immobilisations/actifs');
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
  await moduleNav(page).getByRole('button', { name: 'Configuration', exact: true }).click();
  await shoot(page, '41-accounting-configuration-menu');
  await page.keyboard.press('Escape');

  const domains: [string, string][] = [
    ['/app/comptabilite/tresorerie/comptes', '42-domain-treasury'],
    ['/app/comptabilite/emprunts/liste', '44-domain-loans'],
    ['/app/comptabilite/taxes/declarations', '45-domain-taxes'],
    ['/app/comptabilite/analytique/axes', '46-domain-analytics'],
    ['/app/comptabilite/audit/journal', '47-domain-audit'],
    ['/app/comptabilite/clients', '48-accounting-customers'],
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
  await moduleNav(page).getByRole('button', { name: 'Configuration', exact: true }).click();
  await shoot(page, '53-services-company-configuration-menu');
});

test('loading state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/tableau-de-bord');
  await openMenuItem(page, 'Comptabilité', 'Écritures');
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
  await page.goto('/app/comptabilite/ecritures/nouvelle');
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
  await page.goto('/app/comptabilite/ecritures/nouvelle');
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
  await page.getByRole('button', { name: 'Continuer' }).click();
  await shoot(page, '73-tiers-import-mapping', true);
  await page.getByRole('button', { name: 'Contrôler les lignes' }).click();
  await shoot(page, '74-tiers-import-refused-rows', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/tiers/liste');
  await shoot(page, '75-phone-tiers-list');
});

test('comptabilité: dashboard, journals, chart of accounts, fiscal years', async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/tableau-de-bord');
  await shoot(page, '80-accounting-dashboard', true);
  await page.goto('/app/comptabilite/journaux');
  await shoot(page, '81-accounting-journals');
  await page.goto(`/app/comptabilite/journaux/${api.accounting.books('A').journals[0].public_id}`);
  await shoot(page, '82-accounting-journal');
  await page.goto('/app/comptabilite/plan-comptable?groupe=classe');
  await shoot(page, '83-accounting-chart-grouped', true);
  const forty = api.accounting.books('A').accounts.find((item) => item.code === '40');
  await page.goto(`/app/comptabilite/plan-comptable/${forty?.public_id ?? ''}`);
  await shoot(page, '84-accounting-account-hierarchy', true);
  await page.goto('/app/comptabilite/configuration/exercices');
  await shoot(page, '85-accounting-fiscal-years', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/comptabilite/tableau-de-bord');
  await shoot(page, '86-phone-accounting-dashboard', true);
});

test('écritures: list, form, record, workflow, reversal, unsaved changes', async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/ecritures');
  await shoot(page, '90-entries-list');
  await page.goto('/app/comptabilite/ecritures/nouvelle');
  await fillEntry(page, {
    date: '2026-06-28',
    description: 'Achat de fournitures de bureau',
    lines: [
      ['601', 'Débit', '1 150 000'],
      ['401', 'Crédit', '1 000 000'],
    ],
  });
  await shoot(page, '91-entries-form-lines', true);
  await page.locator('[data-line="1"]').getByRole('textbox', { name: 'Crédit' }).fill('1150000');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Écriture créée.')).toBeVisible();
  await shoot(page, '92-entries-record-draft', true);
  await page.locator('alco-page-header').getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await page.getByRole('textbox', { name: 'Libellé', exact: true }).fill('Libellé changé');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shoot(page, '93-entries-unsaved-changes');
  await page.getByRole('button', { name: 'Quitter' }).click();

  const validated = api.entries.entries('A').find((item) => item.status === 'validated');
  await page.goto(`/app/comptabilite/ecritures/${validated?.public_id}`);
  await page.locator('alco-page-header').getByRole('button', { name: 'Contrepasser' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shoot(page, '94-entries-reverse-dialog');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await createEntry(page, {
    date: '2026-06-27',
    description: 'Achat (téléphone)',
    lines: [
      ['601', 'Débit', '5000'],
      ['401', 'Crédit', '5000'],
    ],
  });
  await shoot(page, '95-phone-entries-record', true);
  await page.goto('/app/comptabilite/ecritures/nouvelle');
  await shoot(page, '96-phone-entries-form', true);
});

test('import: file analysed (CSV, Excel), sheet choice, phone', async ({ page }) => {
  test.setTimeout(90_000);
  const read = async (name: string) => {
    await page.goto('/app/comptabilite/plan-comptable/import');
    await page.locator('input[type=file]').setInputFiles({
      name,
      mimeType: 'text/csv',
      buffer: Buffer.from('Code;Nom du compte;Type\n'),
    });
    await page.getByRole('button', { name: 'Envoyer et lire le fichier' }).click();
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/plan-comptable/import');
  await shoot(page, '97-import-file-choice', true);
  await read('plan-comptable.xlsx');
  await expect(page.locator('.analysis')).toBeVisible();
  await shoot(page, '98-import-analysed-xlsx', true);
  await read('plan-comptable.csv');
  await expect(page.locator('.analysis')).toBeVisible();
  await shoot(page, '99-import-analysed-csv', true);
  await read('plan-feuilles.xlsx');
  await expect(page.getByRole('radio', { name: 'Plan 2026' })).toBeVisible();
  await page.getByRole('radio', { name: 'Plan 2026' }).check();
  await shoot(page, '100-import-sheet-choice', true);
  await page.setViewportSize({ width: 820, height: 1180 });
  await read('plan-comptable.xlsx');
  await expect(page.locator('.analysis')).toBeVisible();
  await shoot(page, '101-tablet-import-analysed-xlsx', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await read('plan-comptable.xlsx');
  await expect(page.locator('.analysis')).toBeVisible();
  await shoot(page, '102-phone-import-analysed-xlsx', true);
});

test('chart of accounts: code groups panel, detailed type, currency, company', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/plan-comptable');
  await page
    .getByRole('navigation', { name: 'Groupes de comptes par début de code' })
    .getByRole('button', { name: 'Déplier 4' })
    .click();
  await shoot(page, '103-chart-code-groups', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/comptabilite/plan-comptable');
  await shoot(page, '104-phone-chart-code-groups', true);
});

test('account form as Odoo: code, name, Comptabilité', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/plan-comptable/nouveau');
  await page.getByLabel('Code').fill('401100');
  await page.getByLabel('Nom du compte').fill('Fournisseurs locaux');
  await page.locator('select[formcontrolname="detailed_type"]').selectOption('liability_payable');
  await shoot(page, '105-account-form-odoo', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/comptabilite/plan-comptable/nouveau');
  await shoot(page, '106-phone-account-form-odoo', true);
});

test('taxes as Odoo: list, record (Définition, Options avancées), form', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/comptabilite/taxes/liste');
  await shoot(page, '107-taxes-list-odoo', true);
  await page.getByRole('link', { name: '18% G', exact: true }).click();
  await expect(page.getByText('Répartition pour les factures')).toBeVisible();
  await shoot(page, '108-tax-record-definition', true);
  await page.getByRole('tab', { name: 'Options avancées' }).click();
  await shoot(page, '109-tax-record-advanced', true);
  await page.getByRole('link', { name: 'Modifier' }).click();
  await expect(page.getByLabel('Nom de la taxe')).toHaveValue('18% G');
  await shoot(page, '110-tax-form-odoo', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/comptabilite/taxes/liste/nouveau');
  await shoot(page, '111-phone-tax-form-odoo', true);
});
