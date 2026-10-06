import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';
import { fixToday, openMenuItem } from './support/navigation';

/**
 * Comptabilité › Trésorerie (Module 6) against the fake API: treasury accounts, operations and
 * their commands, transfers, statements and the server's check, the import of statements
 * through the generic pipeline (valid, duplicate, to verify, refused), the way from a
 * statement line to the reconciliation (V2.1 A6, kept as it is), permissions, company change,
 * session end, deep URLs, keyboard, three screen sizes and accessibility. The fake answers
 * from explicit fixtures (e2e/support/fake-treasury*.ts): nothing is computed anywhere.
 */

const ROOT = '/app/comptabilite/tresorerie';
const rows = (page: Page) => page.locator('alco-table tbody tr');
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
const sectionNav = (page: Page) => page.getByRole('navigation', { name: /Trésorerie/ });

async function importFile(page: Page, name: string) {
  await page.goto(`${ROOT}/releves`);
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Importer des relevés' }).click();
  await expect(page).toHaveURL(/\/tresorerie\/releves\/import$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import de relevés bancaires');
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from('account;amount\nBQ-GNF;300000\n'),
  });
  await page.getByRole('button', { name: 'Envoyer et lire le fichier' }).click();
  await expect(page.getByText('Correspondance des colonnes').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Format des dates' }).selectOption('%d/%m/%Y');
  await page.getByRole('combobox', { name: 'Séparateur décimal' }).selectOption(',');
  await page.getByRole('button', { name: 'Contrôler les lignes' }).click();
  await expect(page.getByText('Lignes correctes')).toBeVisible();
}

test.beforeEach(async ({ page }) => fixToday(page));

test.describe('Trésorerie — comptes', () => {
  test('1-3. ouvrir Trésorerie, ses comptes, un compte : solde et relations du serveur', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Comptabilité', 'Trésorerie');
    await expect(page).toHaveURL(/\/tresorerie\/operations$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opérations de trésorerie');
    await sectionNav(page).getByRole('link', { name: 'Comptes de trésorerie' }).click();
    await expect(page).toHaveURL(/\/tresorerie\/comptes$/);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText('BQ-GNF');
    await expect(rows(page).first()).toContainText('Banque');
    await expect(rows(page).nth(1)).toContainText('Caisse');
    await page.getByRole('link', { name: 'BQ-GNF' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Banque principale A (test)');
    await expect(page.getByText('4 115 000 GNF')).toBeVisible();
    // treasury.manage_accounts: the bank details in full.
    await expect(page.getByText('GN00TEST00012345678')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Opérations : / })).toHaveAttribute(
      'href',
      `${ROOT}/operations?compte=BQ-GNF`,
    );
    await expect(page.getByRole('link', { name: 'Lignes à rapprocher : 3' })).toHaveAttribute(
      'href',
      `${ROOT}/rapprochements?compte=BQ-GNF`,
    );
  });

  test('filtrer les comptes par type : le filtre au serveur, dans l’URL', async ({ page, api }) => {
    await page.goto(`${ROOT}/comptes`);
    await page.getByRole('button', { name: 'Filtres' }).click();
    const filters = page.getByRole('dialog', { name: 'Filtres' });
    await filters.getByRole('combobox', { name: 'Type' }).selectOption('cash');
    await filters.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/type=cash/);
    await expect(rows(page)).toHaveCount(1);
    const call = api.callsTo('treasury/accounts/').at(-1)!;
    expect(new URL(call.url()).searchParams.get('account_type')).toBe('cash');
  });
});

test.describe('Trésorerie — opérations', () => {
  test('4-5. les opérations d’un compte, puis une opération : ses relations et ses commandes', async ({
    page,
  }) => {
    await page.goto(`${ROOT}/comptes`);
    await page.getByRole('link', { name: 'BQ-GNF' }).click();
    await page.getByRole('link', { name: /^Opérations : / }).click();
    await expect(page).toHaveURL(/\/operations\?compte=BQ-GNF$/);
    await expect(rows(page)).toHaveCount(6);
    await page.getByRole('link', { name: 'VIR-201' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('VIR-201');
    await expect(page.getByText('Confirmée').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'CLI-004' })).toBeVisible();
    // A confirmed operation: post it (journal of the account by default), then the server's state.
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Comptabiliser' }).click();
    const dialog = page.getByRole('dialog', { name: 'Comptabiliser l’opération ?' });
    await expect(dialog.getByRole('combobox', { name: 'Journal' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Comptabiliser' }).click();
    await expect(
      page.getByText('Opération comptabilisée : écriture créée en brouillon.'),
    ).toBeVisible();
    await expect(page.getByText('Comptabilisée').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Écriture' })).toBeVisible();
  });

  test('un brouillon : confirmé puis annulé avec un motif', async ({ page }) => {
    await page.goto(`${ROOT}/operations?etat=draft&type=bank_fee`);
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('link', { name: 'FRAIS-09' }).click();
    await expect(page.getByRole('link', { name: 'Modifier' })).toBeVisible();
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Annuler l’opération' }).click();
    const dialog = page.getByRole('dialog', { name: 'Annuler l’opération ?' });
    await dialog.getByRole('button', { name: 'Annuler l’opération' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Indiquez le motif.');
    await dialog.getByLabel('Motif').fill('Frais remboursés par la banque');
    await dialog.getByRole('button', { name: 'Annuler l’opération' }).click();
    await expect(page.getByText('Opération annulée.')).toBeVisible();
    await expect(page.getByText('Cette opération est annulée')).toBeVisible();
    await expect(page.getByText('Frais remboursés par la banque')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0);
  });

  test('un virement : ses deux opérations, confirmées ensemble', async ({ page }) => {
    await page.goto(`${ROOT}/virements`);
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('link', { name: 'VIR-INT-1' }).click();
    await expect(page.getByText('BQ-GNF → CAISSE')).toBeVisible();
    await expect(page.locator('#legs-title ~ alco-table tbody tr')).toHaveCount(2);
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Confirmer le virement' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirmer le virement' })
      .click();
    await expect(page.getByText('Virement confirmé.')).toBeVisible();
    await expect(page.locator('#legs-title ~ alco-table tbody tr').first()).toContainText(
      'Confirmée',
    );
  });
});

test.describe('Trésorerie — relevés', () => {
  test('6-8. relevés, un relevé : contrôle du serveur, étapes, lignes et exclusion', async ({
    page,
  }) => {
    await page.goto(`${ROOT}/releves`);
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('link', { name: 'REL-2026-09' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('REL-2026-09');
    await expect(page.getByRole('status').filter({ hasText: 'Relevé équilibré' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Étapes du relevé' })).toContainText('Rapproché');
    const lines = page.locator('#lignes alco-table tbody tr');
    await expect(lines).toHaveCount(5);
    // A reconciled line is protected: only its reconciliation.
    const reconciled = lines.filter({ hasText: 'VIR CLI-003' });
    await expect(reconciled.getByRole('button')).toHaveCount(0);
    await expect(reconciled.getByRole('link', { name: 'Voir le rapprochement' })).toBeVisible();
    // Set a line aside, with a reason.
    await page.getByRole('button', { name: 'Exclure la ligne du 15/09/2026' }).click();
    const dialog = page.getByRole('dialog', { name: 'Exclure la ligne du 15/09/2026 ?' });
    await dialog.getByLabel('Motif').fill('Frais contestés');
    await dialog.getByRole('button', { name: 'Exclure la ligne' }).click();
    await expect(page.getByText('Ligne exclue du rapprochement.')).toBeVisible();
    await page.getByRole('combobox', { name: 'État des lignes' }).selectOption('excluded');
    await expect(lines).toHaveCount(2);
    await expect(lines.filter({ hasText: 'FRAIS BANCAIRES' })).toContainText(
      'Motif : Frais contestés',
    );
  });

  test('9-10, 12-13. importer un relevé : à vérifier, importé, ses lignes, son écart', async ({
    page,
  }) => {
    await importFile(page, 'releve-octobre.csv');
    const verify = page.getByRole('region', { name: 'Lignes à vérifier' });
    await expect(verify).toContainText('Écart : -10000.');
    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
    await expect(page.getByText('1 relevé', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Lancer l’import' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lancer l’import' }).click();
    await expect(page.getByText('Import terminé', { exact: true })).toBeVisible();
    await page.goto(`${ROOT}/releves`);
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('link', { name: 'REL-2026-10' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Vérification nécessaire' }),
    ).toContainText('-10 000 GNF');
    await expect(page.getByRole('list', { name: 'Étapes du relevé' })).toContainText('Vérifié');
    await expect(page.locator('#lignes alco-table tbody tr')).toHaveCount(2);
    // Closing is refused by the server while the difference stands.
    await page.getByRole('button', { name: 'Clôturer' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Clôturer le relevé' }).click();
    await expect(page.getByText('Le relevé n’est pas équilibré.')).toBeVisible();
  });

  test('11. un relevé déjà présent : ignoré, rien à importer', async ({ page }) => {
    await importFile(page, 'releve-septembre.csv');
    await expect(page.getByText('Déjà existantes (ignorées)')).toBeVisible();
    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
    await expect(page.getByText('déjà existante', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lancer l’import' })).toBeDisabled();
  });

  test('des lignes refusées : leur motif, rien n’est importé', async ({ page }) => {
    await importFile(page, 'releve-errone.csv');
    const refused = page.getByRole('region', { name: 'Lignes refusées' });
    await expect(refused).toContainText('Cette transaction est déjà dans un relevé de ce compte.');
    await expect(page.getByText('rien ne sera importé', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voir l’aperçu' })).toHaveCount(0);
  });

  test('14-19. d’une ligne du relevé au rapprochement A6 : confirmer, dé-rapprocher, lettrage actif', async ({
    page,
    api,
  }) => {
    await page.goto(`${ROOT}/releves`);
    await page.getByRole('link', { name: 'REL-2026-09' }).click();
    await page.getByRole('link', { name: 'Rapprocher', exact: true }).first().click();
    await expect(page).toHaveURL(/\/rapprochements\?compte=BQ-GNF&releve=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rapprochement bancaire');
    await page.getByRole('tab', { name: 'Propositions' }).click();
    await page
      .locator('.proposal')
      .first()
      .getByRole('checkbox', { name: /Régler aussi/ })
      .check();
    await page.getByRole('button', { name: 'Rapprocher la sélection' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Rapprocher la ligne' })
      .click();
    await expect(page.getByRole('region', { name: 'Rapprochements confirmés' })).toBeVisible();
    await page.getByRole('tab', { name: 'Rapprochées' }).click();
    await page.getByRole('button', { name: /^Ouvrir la ligne du .*VIR CLI-003/ }).click();
    await page.getByRole('button', { name: 'Dé-rapprocher' }).click();
    const dialog = page.getByRole('dialog', { name: /^Dé-rapprocher la ligne/ });
    await dialog.getByLabel('Motif').fill('Mauvaise ligne');
    await dialog.getByRole('button', { name: 'Dé-rapprocher' }).click();
    await expect(
      page.getByText('Le lettrage LET-000001 reste actif', { exact: false }),
    ).toBeVisible();
    expect(api.lettering.letterings('A')[0].status).toBe('active');
  });
});

test.describe('Trésorerie — permissions, sociétés, session, URL', () => {
  test('21. lecture seule : ni création, ni import, ni commande ; sans treasury.read, rien', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto(`${ROOT}/comptes`);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Nouveau compte' })).toHaveCount(0);
    await page.goto(`${ROOT}/operations`);
    await expect(page.getByRole('link', { name: 'Nouvelle opération' })).toHaveCount(0);
    await page.getByRole('link', { name: 'VIR-201' }).click();
    await expect(page.getByRole('button', { name: 'Actions' })).toHaveCount(0);
    await page.goto(`${ROOT}/releves`);
    await expect(page.getByRole('button', { name: 'Actions' })).toHaveCount(0);
    await page.getByRole('link', { name: 'REL-2026-09' }).click();
    await expect(page.getByRole('button', { name: 'Clôturer' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Exclure la ligne/ })).toHaveCount(0);

    api.withPermissions(COMPANY_A.public_id, ['accounting.read']);
    await page.goto(`${ROOT}/comptes`);
    await expect(
      page.getByRole('heading', { name: 'Comptes de trésorerie', level: 1 }),
    ).toHaveCount(0);
  });

  test('20. changement de société : la même liste, sans les comptes ni les filtres de A', async ({
    page,
  }) => {
    await page.goto(`${ROOT}/operations?compte=BQ-GNF`);
    await expect(rows(page)).toHaveCount(6);
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page.getByRole('button', { name: /^Société active/ })).toContainText(
      'FILIALE SÉNÉGAL (test)',
    );
    await expect(page).toHaveURL(/\/tresorerie\/operations$/);
    await expect(page.getByText('Aucune opération de trésorerie.')).toBeVisible();
  });

  test('22. session expirée : retour à la connexion', async ({ page, api }) => {
    await page.goto(`${ROOT}/comptes`);
    await expect(rows(page)).toHaveCount(2);
    api.treasury.expireSession();
    await page.getByRole('link', { name: 'BQ-GNF' }).click();
    await expect(page).toHaveURL(/\/login\?raison=session-expiree/);
  });

  test('23. une URL profonde se recharge : la fiche du serveur, son fil d’Ariane', async ({
    page,
  }) => {
    await page.goto(`${ROOT}/releves`);
    await page.getByRole('link', { name: 'REL-2026-09' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('REL-2026-09');
    const url = page.url();
    await page.reload();
    expect(page.url()).toBe(url);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('REL-2026-09');
    await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' })).toContainText(
      'Trésorerie',
    );
    await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' })).toContainText('Relevés');
  });
});

test.describe('Trésorerie — tailles d’écran et accessibilité', () => {
  for (const [name, width, height] of [
    ['bureau', 1440, 900],
    ['tablette', 820, 1180],
    ['téléphone', 390, 844],
  ] as const) {
    test(`25. ${name} : comptes, opération, relevé, import sans défilement horizontal`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      for (const url of [`${ROOT}/comptes`, `${ROOT}/operations`, `${ROOT}/releves`]) {
        await page.goto(url);
        await expect(rows(page).first()).toBeVisible();
        expect(await overflow(), url).toBeLessThanOrEqual(0);
      }
      await page.getByRole('link', { name: 'REL-2026-09' }).click();
      await expect(page.locator('#lignes alco-table tbody tr').first()).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  }

  for (const [name, path] of [
    ['comptes', 'comptes'],
    ['opérations', 'operations'],
    ['virements', 'virements'],
    ['relevés', 'releves'],
  ] as const) {
    test(`26. axe sans violation : liste des ${name}`, async ({ page }) => {
      await page.goto(`${ROOT}/${path}`);
      await expect(rows(page).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await axe(page)).toEqual([]);
    });
  }

  test('24, 26. clavier seul : ouvrir un relevé, exclure une ligne ; axe sans violation', async ({
    page,
  }) => {
    await page.goto(`${ROOT}/releves`);
    await page.getByRole('link', { name: 'REL-2026-09' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('REL-2026-09');
    // Checked once everything is loaded (no skeleton): the check and the lines.
    await expect(page.getByRole('status').filter({ hasText: 'Relevé équilibré' })).toBeVisible();
    await expect(page.locator('#lignes alco-table tbody tr')).toHaveCount(5);
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Exclure la ligne du 15/09/2026' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /^Exclure la ligne/ });
    await expect(dialog.getByLabel('Motif')).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('26. axe sans violation : fiche d’un compte', async ({ page }) => {
    await page.goto(`${ROOT}/comptes`);
    await page.getByRole('link', { name: 'BQ-GNF' }).click();
    await expect(page.getByText('4 115 000 GNF')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
  });

  test('26. axe sans violation : fiche d’une opération', async ({ page }) => {
    await page.goto(`${ROOT}/operations`);
    await page.getByRole('link', { name: 'VIR-201' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('VIR-201');
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
  });

  test('26. axe sans violation : import d’un relevé, contrôles', async ({ page }) => {
    await importFile(page, 'releve-octobre.csv');
    expect(await axe(page)).toEqual([]);
  });
});
