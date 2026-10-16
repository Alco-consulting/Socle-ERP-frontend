import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

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
  await expect(page.getByText('Encodage détecté')).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Correspondance des colonnes').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Format des dates' }).selectOption('%d/%m/%Y');
  await page.getByRole('combobox', { name: 'Séparateur décimal' }).selectOption(',');
  await page.getByRole('button', { name: 'Contrôler les lignes' }).click();
  await expect(page.getByText('Lignes correctes')).toBeVisible();
}

test.beforeEach(async ({ page }) => fixToday(page));

test.describe('Trésorerie — sans onglet, comme Odoo', () => {
  test('1-3. un journal de banque est son compte : les anciennes adresses mènent aux journaux', async ({
    page,
  }) => {
    // Note backend 0043: no « Comptes de trésorerie » screen, no « Trésorerie » bar.
    await page.goto(`${ROOT}/comptes`);
    await expect(page).toHaveURL(/\/app\/comptabilite\/journaux$/);
    await page.goto(`${ROOT}/comptes/t-bq`);
    await expect(page).toHaveURL(/\/app\/comptabilite\/journaux$/);
    await page.goto(`${ROOT}/operations?compte=BQ-GNF`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opérations de trésorerie');
    await expect(page.getByRole('navigation', { name: /Trésorerie/ })).toHaveCount(0);
  });
});

test.describe('Trésorerie — opérations', () => {
  test('4-5. les opérations d’un compte, puis une opération : ses relations et ses commandes', async ({
    page,
  }) => {
    await page.goto(`${ROOT}/operations?compte=BQ-GNF`);
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
    await page.goto(`${ROOT}/operations`);
    await expect(
      page.getByRole('heading', { name: 'Opérations de trésorerie', level: 1 }),
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
    await page.goto(`${ROOT}/operations`);
    await expect(rows(page).first()).toBeVisible();
    api.treasury.expireSession();
    await page.getByRole('link', { name: 'VIR-201' }).click();
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
    test(`25. ${name} : opérations, relevé, import sans défilement horizontal`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      for (const url of [`${ROOT}/operations`, `${ROOT}/releves`]) {
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

test.describe('Réconciliation bancaire — comme Odoo (note backend 0044)', () => {
  const entry = (page: Page) => page.locator('tr.entry');
  const lines = (page: Page) => page.locator('table.lines tbody tr:not(.entry)');
  /** As Odoo's buttons on the line: « Partenaire », « Compte », ⋮ (note backend 0048). */
  const press = (page: Page, name: string) =>
    entry(page).getByRole('button', { name, exact: true }).click();
  const more = async (page: Page, item: string) => {
    await entry(page).getByRole('button', { name: 'Plus de choix' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };

  test('une ligne : le partenaire, sa facture non payée, l’entrée ; ajoutée et lettrée', async ({
    page,
  }) => {
    await page.goto(`${ROOT}/transactions?compte=BQ-GNF`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Réconciliation bancaire');
    await expect(page.locator('table.lines thead th')).toHaveText([
      'Date',
      'Libellé',
      'Partenaire',
      'Facture',
      'Entrée',
      'Sortie',
      'Solde courant',
      'Détails',
    ]);
    // Every field of the new line on one row.
    const top = await entry(page).boundingBox();
    expect(top && top.height < 80).toBe(true);
    await press(page, 'Partenaire');
    await entry(page).getByRole('combobox', { name: 'Partenaire' }).fill('CLI-002');
    await page.getByRole('option', { name: /CLI-002/ }).click();

    // The partner's unpaid invoices, in the same cell; what remains on the one chosen comes in.
    const invoices = entry(page).getByRole('combobox', { name: 'Facture non payée' });
    await expect(invoices.locator('option')).toHaveCount(3);
    await expect(invoices.locator('option').nth(1)).toHaveText(
      /FAC-103 · 06\/09\/2026 · 750\s000 GNF/,
    );
    await invoices.selectOption({ index: 1 });
    await expect(entry(page).getByRole('textbox', { name: 'Entrée' })).toHaveValue('750000');
    await expect(entry(page).getByRole('textbox', { name: 'Libellé' })).toHaveValue(
      'Règlement FAC-103',
    );
    await entry(page).getByRole('textbox', { name: 'Entrée' }).press('Enter');

    const first = lines(page).first();
    await expect(first).toContainText('Règlement FAC-103');
    await expect(first.locator('.counterpart')).toHaveText('FAC-103');
    await expect(first.locator('td').nth(4)).toHaveText(/^750\s000 GNF$/);
    // Lettered at once: the invoice is no longer offered; a new line to type.
    await press(page, 'Partenaire');
    await entry(page).getByRole('combobox', { name: 'Partenaire' }).fill('CLI-002');
    await page.getByRole('option', { name: /CLI-002/ }).click();
    await expect(invoices.locator('option')).toHaveCount(2);
    expect(await axe(page)).toEqual([]);
  });

  test('un fournisseur sans facture : une avance, la sortie ; Enregistrer', async ({
    page,
    api,
  }) => {
    await page.goto(`${ROOT}/transactions?compte=BQ-GNF`);
    await entry(page).getByRole('textbox', { name: 'Libellé' }).fill('frais achat d’eau');
    await press(page, 'Partenaire');
    await entry(page).getByRole('combobox', { name: 'Partenaire' }).fill('FOU-001');
    await page.getByRole('option', { name: /FOU-001/ }).click();
    await expect(
      entry(page).getByRole('combobox', { name: 'Facture non payée' }).locator('option').first(),
    ).toHaveText(/Aucune facture/);
    await entry(page).getByRole('textbox', { name: 'Sortie' }).fill('25000');
    await page.locator('alco-page-header').getByRole('button', { name: 'Enregistrer' }).click();
    await expect(lines(page).first()).toContainText('frais achat d’eau');
    await expect(lines(page).first().locator('td').nth(5)).toHaveText(/^25\s000 GNF$/);
    await expect(entry(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nouveau' })).toBeVisible();
    const post = api.calls.filter(
      (call) => call.method() === 'POST' && call.url().includes('/transactions/'),
    );
    expect(post[0].postDataJSON()).toMatchObject({
      direction: 'outflow',
      amount: '25000',
      settled_line: null,
      offset_account: null,
    });
  });

  test('un virement interne : la sortie de la banque, l’entrée dans la caisse, en une fois', async ({
    page,
  }) => {
    // Note backend 0046: ⋮ « Virements internes », then the other journal.
    await page.goto(`${ROOT}/transactions?compte=BQ-GNF`);
    await more(page, 'Virements internes');
    const journal = entry(page).getByRole('combobox', { name: 'Autre journal' });
    await expect(journal.locator('option:checked')).toHaveText('Caisse A (test)');
    await expect(entry(page).getByRole('combobox', { name: 'Facture non payée' })).toHaveCount(0);
    await entry(page).getByRole('textbox', { name: 'Sortie' }).fill('100000');
    await entry(page).getByRole('textbox', { name: 'Sortie' }).press('Enter');

    const out = lines(page).first();
    await expect(out.locator('.partner')).toHaveText('Virement interne');
    await expect(out.locator('.counterpart')).toHaveText('Caisse A (test)');
    await expect(out.locator('td').nth(5)).toHaveText(/^100\s000 GNF$/);

    await page.goto(`${ROOT}/transactions?compte=CAISSE`);
    const into = lines(page).first();
    await expect(into).toContainText(
      'Virement interne Banque principale A (test) → Caisse A (test)',
    );
    await expect(into.locator('.counterpart')).toHaveText('Banque principale A (test)');
    await expect(into.locator('td').nth(4)).toHaveText(/^100\s000 GNF$/);
  });

  test('« Compte » ou un modèle du menu ⋮ ; « Gérer modèles » ouvre les modèles', async ({
    page,
  }) => {
    // Note backend 0048: any account of the chart, without partner.
    await page.goto(`${ROOT}/transactions?compte=BQ-GNF`);
    await entry(page).getByRole('textbox', { name: 'Libellé' }).fill('achat de marchandises');
    await press(page, 'Compte');
    await entry(page).getByRole('combobox', { name: 'Compte' }).fill('601');
    await page.getByRole('option', { name: /^601\b/ }).click();
    await entry(page).getByRole('textbox', { name: 'Sortie' }).fill('40000');
    await entry(page).getByRole('textbox', { name: 'Sortie' }).press('Enter');
    await expect(lines(page).first()).toContainText('achat de marchandises');

    // A model: its account and its label in one click.
    await more(page, 'Frais bancaires');
    await expect(entry(page).getByRole('textbox', { name: 'Libellé' })).toHaveValue(
      'Frais bancaires',
    );
    await entry(page).getByRole('textbox', { name: 'Sortie' }).fill('15000');
    await entry(page).getByRole('textbox', { name: 'Sortie' }).press('Enter');
    await expect(lines(page).filter({ hasText: '15 000' }).locator('.counterpart')).toHaveText(
      '631100 Frais bancaires',
    );
    expect(await axe(page)).toEqual([]);

    // « Gérer modèles »: Odoo's list, a model added.
    await more(page, 'Gérer modèles');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Modèles de rapprochement');
    await expect(page.getByRole('row', { name: /Virements internes/ })).toBeVisible();
    await page.getByRole('button', { name: 'Nouveau' }).click();
    await page.getByRole('textbox', { name: 'Nom du modèle' }).fill('Agios');
    await page.getByRole('combobox', { name: 'Compte' }).fill('601');
    await page.getByRole('option', { name: /^601\b/ }).click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('row', { name: /Agios/ })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});
