import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { dateField, confirmWith, createEntry, fillLine } from './support/entries';
import { COMPANY_A, COMPANY_B, PROFILES, expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/**
 * Comptabilité › Écritures (Module 5) on the fake API (e2e/support/fake-accounting-entries.ts):
 * the 13 scenarios of the module. Nothing reaches the real API.
 */

const LIST = '/app/comptabilite/ecritures/pieces';
/** A record and the form live beside the lines (« Écritures comptables »). */
const ENTRIES = '/app/comptabilite/ecritures';
const companyButton = (page: Page) => page.getByRole('button', { name: /^Société active/ });
const header = (page: Page) => page.locator('alco-page-header');
const rows = (page: Page) => page.locator('tbody tr');

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(', ')}`,
  );
}

async function switchTo(page: Page, name: RegExp): Promise<void> {
  await companyButton(page).click();
  await page.getByRole('menuitemradio', { name }).click();
}

async function openFilters(page: Page) {
  await page.getByRole('button', { name: /^Filtres/ }).click();
  return page.getByRole('dialog', { name: 'Filtres' });
}

const ENTRY = {
  date: '2026-06-28',
  description: 'Achat de fournitures de bureau',
  lines: [
    ['601', 'Débit', '1 150 000'],
    ['401', 'Crédit', '1150000'],
  ],
} as const;

test.describe('Écritures — liste', () => {
  test('Scénario 1 : Comptabilité → Écritures, la liste du serveur et ses pages', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Comptabilité', 'Pièces comptables');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pièces comptables');
    await expect(page.getByRole('note', { name: 'Démonstration' })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(25);
    await expect(page.getByText(/1–25\s*sur\s*48/)).toBeVisible();

    await page.getByRole('button', { name: 'Page suivante' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/26–48\s*sur\s*48/)).toBeVisible();
    const last = api.callsTo('accounting/entries/').at(-1);
    expect(new URL(last!.url()).searchParams.get('page')).toBe('2');
    for (const call of api.callsTo('accounting/entries/')) {
      expect(await call.headerValue('x-company-id')).toBe(COMPANY_A.public_id);
    }
    expect(await axe(page)).toEqual([]);
  });

  test('Scénario 2 : recherche par les paramètres de l’API (compte), pas de recherche inventée', async ({
    page,
    api,
  }) => {
    await page.goto(LIST);
    await expect(rows(page).first()).toBeVisible();
    // The API has no text search for entries: no search box.
    await expect(page.getByRole('searchbox')).toHaveCount(0);

    const panel = await openFilters(page);
    await panel.getByRole('combobox', { name: 'Compte' }).fill('411');
    await page.getByRole('option', { name: /^411\b/ }).click();
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/compte=411/);
    const account = api.accounting.books('A').accounts.find((item) => item.code === '411');
    await expect
      .poll(() =>
        new URL(api.callsTo('accounting/entries/').at(-1)!.url()).searchParams.get('account'),
      )
      .toBe(account?.public_id);

    // A link with an unknown code: said, not invented.
    await page.goto(`${LIST}?compte=999`);
    await expect(
      page.getByText('Aucun compte de cette société n’a le code « 999 ».'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
    await expect(page).not.toHaveURL(/compte=/);
    await expect(rows(page)).toHaveCount(25);
  });

  test('Scénario 3 : filtres et favoris du serveur, gardés dans l’URL', async ({ page, api }) => {
    await page.goto(LIST);
    const panel = await openFilters(page);
    await panel.getByLabel('État').selectOption({ label: 'Soumise' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/etat=submitted/);
    await expect(page.getByRole('button', { name: 'Filtres (1)' })).toBeFocused();
    await expect(rows(page)).toHaveCount(4);
    for (const row of await rows(page).all()) {
      await expect(row).toContainText('Soumise');
    }
    expect(
      new URL(api.callsTo('accounting/entries/').at(-1)!.url()).searchParams.get('status'),
    ).toBe('submitted');

    await page.getByRole('button', { name: 'Favoris' }).click();
    await page.getByRole('menuitem', { name: 'Brouillons' }).click();
    await expect(page).toHaveURL(/etat=draft/);
    await expect(rows(page)).toHaveCount(12);

    // Back keeps the previous filter (the URL is the list's state).
    await page.goBack();
    await expect(page).toHaveURL(/etat=submitted/);
    await expect(rows(page)).toHaveCount(4);
  });
});

test.describe('Écritures — saisie', () => {
  test('Scénarios 4 à 6 : nouvelle écriture, lignes ajoutées et modifiées, enregistrement', async ({
    page,
    api,
  }) => {
    await page.goto(LIST);
    await page.getByRole('link', { name: 'Nouvelle écriture' }).click();
    await expect(page).toHaveURL(/\/ecritures\/nouvelle$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouvelle écriture');

    await page.getByLabel('Journal').selectOption({ label: 'OD — Opérations diverses' });
    await dateField(page).fill(ENTRY.date);
    await page.getByRole('textbox', { name: 'Libellé', exact: true }).fill(ENTRY.description);
    await fillLine(page, 0, '601', 'Débit', '1 150 000');
    await fillLine(page, 1, '401', 'Crédit', '1 000 000');
    const totals = page.locator('dl.totals');
    await expect(totals).toContainText(/Écart\s*150\s000/);

    // A line modified, a line added then removed.
    await page.locator('[data-line="1"]').getByRole('textbox', { name: 'Crédit' }).fill('1150000');
    await expect(totals).toContainText('Équilibrée');
    await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
    await expect(page.locator('[data-line]')).toHaveCount(3);
    await expect(
      page.locator('[data-line="2"]').getByRole('combobox', { name: 'Compte' }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Retirer la ligne 3' }).click();
    await expect(page.locator('[data-line]')).toHaveCount(2);

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Écriture créée.')).toBeVisible();
    await expect(page).toHaveURL(/\/ecritures\/20000000-[\w-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écriture sans numéro');
    await expect(header(page)).toContainText('Brouillon');

    const posts = api.callsTo('accounting/entries/').filter((call) => call.method() === 'POST');
    expect(posts).toHaveLength(1);
    const accounts = api.accounting.books('A').accounts;
    const id = (code: string) => accounts.find((item) => item.code === code)?.public_id;
    expect(posts[0].postDataJSON()).toEqual({
      journal: api.accounting.books('A').journals.find((item) => item.code === 'OD')?.public_id,
      entry_date: ENTRY.date,
      description: ENTRY.description,
      lines: [
        { account: id('601'), debit: '1150000' },
        { account: id('401'), credit: '1150000' },
      ],
    });
    expect(await axe(page)).toEqual([]);
  });

  test('pièces justificatives et historique de l’Audit sur la fiche', async ({ page }) => {
    await createEntry(page, ENTRY);
    await expect(page.getByText('Aucune pièce jointe.')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({
      name: 'facture-0123.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fictitious'),
    });
    await expect(page.getByText('Pièce « facture-0123.pdf » jointe.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'facture-0123.pdf' })).toBeVisible();
    const history = page.locator('alco-object-history');
    await expect(history).toContainText('Création');
    await expect(history).toContainText('mariam.test@example.org');
  });
});

test.describe('Écritures — workflow du serveur', () => {
  test('Scénario 7 : soumission puis validation, numéro attribué par le serveur', async ({
    page,
    api,
  }) => {
    await createEntry(page, ENTRY);
    // Company A requires a submission: no validation straight from the draft.
    await expect(header(page).getByRole('button', { name: 'Valider' })).toHaveCount(0);
    await header(page).getByRole('button', { name: 'Soumettre' }).click();
    await confirmWith(page, 'Soumettre');
    await expect(page.getByText('Écriture soumise pour validation.')).toBeVisible();
    await expect(header(page)).toContainText('Soumise');

    await header(page).getByRole('button', { name: 'Valider' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('attribue le numéro définitif');
    await confirmWith(page, 'Valider l’écriture');
    await expect(page.getByText(/Écriture validée : n° OD-\d{6}\./)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^OD-\d{6}$/);
    await expect(header(page)).toContainText('Validée');
    const commands = api.calls
      .filter((call) => call.method() === 'POST')
      .map((call) => new URL(call.url()).pathname.split('/').at(-2));
    expect(commands).toEqual(expect.arrayContaining(['submit', 'validate']));
    expect(api.calls.filter((call) => call.method() === 'PATCH')).toHaveLength(0);
  });

  test('un refus du serveur (écriture déséquilibrée) : expliqué, code dans les détails', async ({
    page,
  }) => {
    await createEntry(page, {
      ...ENTRY,
      lines: [
        ['601', 'Débit', '1000'],
        ['401', 'Crédit', '900'],
      ],
    });
    await expect(page.getByText(/Écart de 100 GNF/)).toBeVisible();
    await header(page).getByRole('button', { name: 'Soumettre' }).click();
    await confirmWith(page, 'Soumettre');
    await header(page).getByRole('button', { name: 'Valider' }).click();
    await confirmWith(page, 'Valider l’écriture');
    const alert = page.getByRole('alert').filter({ hasText: 'L’écriture n’est pas équilibrée.' });
    await expect(alert).toBeVisible();
    await expect(alert.getByText('accounting_entry_unbalanced')).toBeHidden();
    await alert.getByText('Détails techniques (support)').click();
    await expect(alert.getByText('accounting_entry_unbalanced')).toBeVisible();
    await expect(header(page)).toContainText('Soumise');
  });

  test('Scénario 8 : consultation d’une écriture validée, en lecture seule', async ({
    page,
    api,
  }) => {
    const validated = api.entries.entries('A').find((item) => item.status === 'validated');
    await page.goto(`${ENTRIES}/${validated?.public_id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(validated!.entry_number);
    await expect(page.getByText('Validée : elle ne se modifie plus.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lignes de l’écriture' })).toContainText('Totaux');
    await header(page).getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Verrouiller' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Modifier' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('navigation', { name: 'Fil d’Ariane' }).getByText(validated!.entry_number),
    ).toBeVisible();

    await page.goto(`${ENTRIES}/${validated?.public_id}/modifier`);
    await expect(page.getByText('Cette écriture ne peut pas être modifiée.')).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });

  test('Scénario 9 : contrepassation, une nouvelle écriture en brouillon', async ({
    page,
    api,
  }) => {
    const validated = api.entries.entries('A').find((item) => item.status === 'validated');
    await page.goto(`${ENTRIES}/${validated?.public_id}`);
    await header(page).getByRole('button', { name: 'Contrepasser' }).click();
    const dialog = page.getByRole('dialog', { name: `Contrepasser ${validated?.entry_number} ?` });
    await expect(dialog).toContainText('chaque ligne inversée');
    await dialog.getByLabel('Date de la contrepassation').fill('2026-06-20');
    await dialog.getByRole('button', { name: 'Créer la contrepassation' }).click();
    await expect(dialog.getByText('Indiquez la date et le motif')).toBeVisible();
    await dialog.getByLabel('Motif').fill('Facture annulée par le fournisseur');
    await dialog.getByRole('button', { name: 'Créer la contrepassation' }).click();

    await expect(
      page.getByText('Contrepassation créée en brouillon : elle reste à valider.'),
    ).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(validated!.public_id));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écriture sans numéro');
    await expect(page.getByText('Facture annulée par le fournisseur')).toBeVisible();
    await expect(page.getByText('Contrepassation : ses lignes viennent')).toBeVisible();
    const reverse = api.calls.find((call) => call.url().endsWith('/reverse/'));
    expect(reverse?.postDataJSON()).toEqual({
      entry_date: '2026-06-20',
      reason: 'Facture annulée par le fournisseur',
    });

    // The original, once only.
    await page.getByRole('link', { name: 'L’écriture d’origine' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(validated!.entry_number);
    await header(page).getByRole('button', { name: 'Contrepasser' }).click();
    await page.getByRole('dialog').getByLabel('Date de la contrepassation').fill('2026-06-21');
    await page.getByRole('dialog').getByLabel('Motif').fill('Deuxième essai');
    await page.getByRole('button', { name: 'Créer la contrepassation' }).click();
    await expect(page.getByText('Cette écriture a déjà été contrepassée.')).toBeVisible();
  });
});

test.describe('Écritures — droits, société, modifications', () => {
  test('Scénario 10 : profil en lecture seule, aucune action', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto(LIST);
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Actions' })).toHaveCount(0);
    const draft = api.entries.entries('A').find((item) => item.status === 'draft');
    await page.goto(`${ENTRIES}/${draft?.public_id}`);
    await expect(header(page)).toContainText('Brouillon');
    await expect(header(page).getByRole('button')).toHaveCount(0);

    await page.goto(`${ENTRIES}/nouvelle`);
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/);
    await expect(page.getByText('Votre profil ne permet pas d’ouvrir cet écran.')).toBeVisible();
  });

  test('Scénario 11 : écriture créée dans Alpha, changement vers Beta, rien d’Alpha', async ({
    page,
    api,
  }) => {
    await createEntry(page, { ...ENTRY, description: 'Écriture propre à Alpha' });
    const alphaRecord = page.url();

    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(companyButton(page)).toContainText('FILIALE SÉNÉGAL (test)');
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/); // the list, never a record
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures comptables');
    await page.getByRole('link', { name: 'Pièces comptables' }).click();
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByText('Écriture propre à Alpha')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(6);
    for (const row of await rows(page).all()) {
      await expect(row).toContainText('SN-VTE');
    }
    const last = api.callsTo('accounting/entries/').at(-1);
    expect(await last?.headerValue('x-company-id')).toBe(COMPANY_B.public_id);

    // Alpha's record is not reachable in Beta (the server's 404).
    await page.goto(alphaRecord);
    await expect(
      page.getByText('Cette écriture n’existe pas ou plus dans cette société.'),
    ).toBeVisible();

    // Back to Alpha: the server kept it.
    // No reload before the switch is done: the tab would reopen in Beta.
    await switchTo(page, /ALCO GUINÉE/);
    await expect(companyButton(page)).toContainText('ALCO GUINÉE (test)');
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/); // the list, never a record
    await page.getByRole('link', { name: 'Pièces comptables' }).click();
    await expect(page.getByRole('cell', { name: /Écriture propre à Alpha/ })).toBeVisible();
  });

  test('Scénario 12 : modification abandonnée, confirmation demandée', async ({ page }) => {
    await createEntry(page, ENTRY);
    const record = page.url();
    await header(page).getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    await expect(page).toHaveURL(/\/modifier$/);
    const description = page.getByRole('textbox', { name: 'Libellé', exact: true });
    await expect(description).toHaveValue(ENTRY.description);
    await description.fill('Libellé changé, non enregistré');

    // Leaving by the breadcrumb: asked; « Continuer l'édition » keeps the change.
    await page
      .getByRole('navigation', { name: 'Fil d’Ariane' })
      .getByRole('link', { name: 'Écritures' })
      .click();
    const question = page.getByRole('alertdialog', { name: 'Modifications non enregistrées' });
    await expect(question).toContainText('Voulez-vous vraiment quitter ?');
    await question.getByRole('button', { name: 'Continuer l’édition' }).click();
    await expect(page).toHaveURL(/\/modifier$/);
    await expect(description).toHaveValue('Libellé changé, non enregistré');

    // A company switch asks too.
    await switchTo(page, /FILIALE SÉNÉGAL/);
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Continuer l’édition' }).click();
    await expect(companyButton(page)).toContainText('ALCO GUINÉE (test)');

    // « Annuler » then « Quitter »: back to the record, nothing saved.
    await page.getByRole('button', { name: 'Annuler' }).click();
    await question.getByRole('button', { name: 'Quitter' }).click();
    await expect(page).toHaveURL(record);
    await expect(header(page)).toContainText(ENTRY.description);
  });

  test('Scénario 13 : téléphone, une colonne, lignes dans un cadre adapté', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ENTRIES}/nouvelle`);
    const line = page.locator('[data-line="0"]');
    await expect(line).toBeVisible();
    const account = await line.getByRole('combobox', { name: 'Compte' }).boundingBox();
    const debit = await line.getByRole('textbox', { name: 'Débit' }).boundingBox();
    expect(Math.abs((account?.x ?? 0) - (debit?.x ?? 1))).toBeLessThan(2); // one column
    expect(debit!.y).toBeGreaterThan(account!.y);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(await axe(page)).toEqual([]);

    await page.goto(LIST);
    await expect(rows(page).first()).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await rows(page).first().getByRole('link').click();
    await expect(page.getByRole('table', { name: 'Lignes de l’écriture' })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
