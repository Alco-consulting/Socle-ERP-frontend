import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';

/**
 * Comptabilité › Plan comptable › Actions ▾ › Importer des comptes (`accounting.accounts`)
 * against the fake API: the generic import screen (file, mapping, checks, preview, import),
 * accounts created flat, duplicates ignored, refused rows and their reason, a file sent twice,
 * a server failure, permissions, company change, deep URL, three screen sizes and
 * accessibility. The fake answers from explicit scenarios (e2e/support/fake-account-import.ts).
 */

const ROOT = '/app/comptabilite/plan-comptable';
const rows = (page: Page) => page.locator('alco-table tbody tr');
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );

async function openImport(page: Page) {
  await page.goto(ROOT);
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Importer des comptes' }).click();
  await expect(page).toHaveURL(/\/plan-comptable\/import$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import du plan comptable');
}

async function sendFile(page: Page, name: string) {
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from('Code;Nom du compte;Type\n101100;Capital;Capitaux propres\n'),
  });
  await page.getByRole('combobox', { name: 'Séparateur de colonnes' }).selectOption(';');
  await page.getByRole('button', { name: 'Envoyer et lire le fichier' }).click();
  await expect(page.getByText('Correspondance des colonnes').first()).toBeVisible();
}

async function check(page: Page, name: string) {
  await openImport(page);
  await sendFile(page, name);
  await page.getByRole('button', { name: 'Contrôler les lignes' }).click();
}

test.describe('Plan comptable — import', () => {
  test('1, 3-5, 7-8. menu, fichier, colonnes, contrôles, aperçu, import : comptes à plat', async ({
    page,
    api,
  }) => {
    await openImport(page);
    await sendFile(page, 'plan-comptable.csv');
    // The file's columns are suggested from the server's fields; nothing else is asked.
    await expect(page.getByRole('combobox', { name: 'Code' })).toHaveValue('Code');
    await expect(page.getByRole('combobox', { name: 'Nom du compte' })).toHaveValue(
      'Nom du compte',
    );
    await expect(page.getByRole('combobox', { name: 'Type' })).toHaveValue('Type');
    await expect(page.getByRole('combobox', { name: /Parent/ })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Format des dates' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Contrôler les lignes' }).click();
    await expect(page.getByText('Lignes correctes')).toBeVisible();
    await expect(page.getByText('Déjà existantes (ignorées)')).toBeVisible();

    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
    await expect(page.getByText('3 comptes', { exact: true })).toBeVisible();
    await expect(page.getByText('1 ligne déjà existante', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Lancer l’import' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lancer l’import' }).click();
    await expect(page.getByText('Import terminé', { exact: true })).toBeVisible();

    await page.goto(ROOT);
    await expect(rows(page).filter({ hasText: '101100' })).toContainText(
      'Capital engagé non appelé',
    );
    // Created flat, as the server does: no parent, no sub-account.
    const created = api.accounting.books('A').accounts.filter((item) => item.account_class === '');
    expect(created.map((item) => [item.code, item.parent])).toEqual([
      ['101100', null],
      ['521100', null],
      ['605100', null],
    ]);
  });

  test('6. lignes refusées : leur motif (type inconnu, nom manquant), rien n’est importé', async ({
    page,
  }) => {
    await check(page, 'plan-errone.csv');
    const refused = page.getByRole('region', { name: 'Lignes refusées' });
    await expect(refused).toContainText(
      'Type : Type inconnu : seuls les libellés validés du plan sont acceptés. Valeur lue : « Capitaux Propres ».',
    );
    await expect(refused).toContainText('Nom du compte : Valeur obligatoire manquante.');
    await expect(page.getByText('rien ne sera importé', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voir l’aperçu' })).toHaveCount(0);
  });

  test('8. un fichier déjà importé : refusé par le serveur', async ({ page }) => {
    await check(page, 'plan-comptable.csv');
    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
    await page.getByRole('button', { name: 'Lancer l’import' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lancer l’import' }).click();
    await expect(page.getByText('Import terminé', { exact: true })).toBeVisible();

    await openImport(page);
    await page.locator('input[type=file]').setInputFiles({
      name: 'plan-comptable.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Code;Nom du compte;Type\n'),
    });
    await page.getByRole('button', { name: 'Envoyer et lire le fichier' }).click();
    await expect(page.getByText('Ce fichier a déjà été importé.')).toBeVisible();
  });

  test('9. erreur du serveur pendant les contrôles : dite, rien n’est importé', async ({
    page,
    api,
  }) => {
    api.accountImport.breakNextValidation();
    await check(page, 'plan-comptable.csv');
    await expect(page.getByText('Une erreur inattendue s’est produite.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voir l’aperçu' })).toHaveCount(0);
  });

  test('plan vide : l’import est proposé à côté de la création', async ({ page, api }) => {
    api.accounting.books('A').accounts.length = 0;
    await page.goto(ROOT);
    await expect(page.getByText('Le plan comptable de cette société est vide.')).toBeVisible();
    await page.getByRole('link', { name: 'Importer des comptes' }).click();
    await expect(page).toHaveURL(/\/plan-comptable\/import$/);
  });
});

test.describe('Plan comptable — import : permissions, société, URL', () => {
  test('2. sans accounting.manage_accounts ou sans imports_exports.create : ni menu ni écran', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto(ROOT);
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actions' })).toHaveCount(0);
    await page.goto(`${ROOT}/import`);
    await expect(page).toHaveURL(/\/plan-comptable$/);
    await expect(page.getByText('Votre profil ne permet pas d’ouvrir cet écran.')).toBeVisible();

    api.withPermissions(
      COMPANY_A.public_id,
      PROFILES.accountant.filter((code) => code !== 'imports_exports.create'),
    );
    await page.goto(ROOT);
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actions' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Nouveau compte' })).toBeVisible();
  });

  test('10. changement de société : la liste de la nouvelle société, l’import abandonné', async ({
    page,
    api,
  }) => {
    await openImport(page);
    await sendFile(page, 'plan-comptable.csv');
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page.getByRole('button', { name: /^Société active/ })).toContainText(
      'FILIALE SÉNÉGAL (test)',
    );
    await expect(page).toHaveURL(/\/plan-comptable$/);
    await expect(rows(page).filter({ hasText: '701' })).toHaveCount(1);
    await expect
      .poll(() => api.calls.some((call) => call.url().includes('/acc-run-1/cancel/')))
      .toBe(true);
  });

  test('11. URL directe /plan-comptable/import : l’écran et son fil d’Ariane', async ({ page }) => {
    await page.goto(`${ROOT}/import`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import du plan comptable');
    await expect(page.getByRole('navigation', { name: /Fil d’Ariane/ })).toContainText(
      'Import du plan comptable',
    );
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import du plan comptable');
    await expect(page.getByText('Champs de l’import, donnés par le serveur')).toBeVisible();
  });
});

test.describe('Plan comptable — import : tailles d’écran et accessibilité', () => {
  for (const [name, width, height] of [
    ['bureau', 1440, 900],
    ['tablette', 820, 1180],
    ['téléphone', 390, 844],
  ] as const) {
    test(`12. ${name} : liste, fichier, contrôles sans défilement horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      await page.goto(ROOT);
      await expect(rows(page).first()).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
      await check(page, 'plan-errone.csv');
      await expect(page.getByRole('region', { name: 'Lignes refusées' })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  }

  test('13. axe sans violation : choix du fichier', async ({ page }) => {
    await openImport(page);
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
  });

  test('13. axe sans violation : contrôles et lignes refusées', async ({ page }) => {
    await check(page, 'plan-errone.csv');
    await expect(page.getByRole('region', { name: 'Lignes refusées' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});
