import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { createEntry } from './support/entries';
import { COMPANY_A, COMPANY_B, PROFILES, expect, test } from './support/fake-api';
import { fixToday, openMenuItem } from './support/navigation';

/**
 * Comptabilité, accounting base (Module 4), on the fake API: dashboard, journals, chart of
 * accounts, fiscal years and periods. Nothing reaches the real API.
 */

const moduleNav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Comptabilité' });
const codes = (page: Page) => page.locator('tbody a.code');
const companyButton = (page: Page) => page.getByRole('button', { name: /^Société active/ });

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map((violation) => violation.id);
}

test.describe('Comptabilité — tableau de bord réel', () => {
  test.beforeEach(async ({ page }) => fixToday(page));

  test('Scénarios 1 et 2 : lanceur → Comptabilité → tableau de bord de l’API', async ({
    page,
    api,
  }) => {
    await page.goto('/app');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tableau de bord');
    // The company only, in the top bar: the fiscal years are the server's business (note
    // backend 0035) — no page heading carries them.
    await expect(
      page.getByRole('button', { name: /Société active : ALCO GUINÉE \(test\)/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Exercice');
    await expect(page.getByRole('note', { name: 'Démonstration' })).toHaveCount(0);

    // As Odoo's (note backend 0042): one card per active journal, bank and cash first.
    await expect(page.locator('.card-title')).toHaveText([
      'Caisse',
      'Banque principale',
      'Ventes',
      'Achats',
      'Opérations diverses',
    ]);
    // No fiscal year nor chart of accounts block: the menu opens the chart.
    await expect(page.locator('alco-card', { hasText: 'Exercice et périodes' })).toHaveCount(0);
    await expect(page.locator('alco-card', { hasText: 'Plan comptable' })).toHaveCount(0);

    // A fixed number of requests: no request per journal, nothing read from Accounting but
    // the fiscal years of the indicators' period; the journals: one dashboards call.
    await page.waitForLoadState('networkidle');
    const accounting = api.calls.filter((call) => {
      const path = new URL(call.url()).pathname;
      return path.startsWith('/api/v1/accounting/') && path !== '/api/v1/accounting/fiscal-years/';
    });
    expect(accounting).toHaveLength(0);
    const journals = api.callsTo('dashboards/journals/');
    expect(journals).toHaveLength(1);
    expect(await journals[0].headerValue('x-company-id')).toBe(COMPANY_A.public_id);
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('Comptabilité — journaux', () => {
  test('Scénario 3 : liste, filtre, fiche, création, désactivation', async ({ page, api }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    // Les journaux : Configuration › Comptabilité (plus de doublon dans le menu Comptabilité).
    await openMenuItem(page, 'Configuration', 'Journaux');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Journaux');
    // By code (ACH, ANC, BQ1, CAI, OD, VTE): each row links its journal by its name.
    await expect(codes(page)).toHaveText([
      'Achats',
      'Ancien journal',
      'Banque principale',
      'Caisse',
      'Opérations diverses',
      'Ventes',
    ]);
    await expect(page.getByRole('switch', { name: 'Journal ANC actif' })).not.toBeChecked();

    await page.getByRole('button', { name: 'Filtres' }).click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('Type').selectOption({ label: 'Banque' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/type=bank/);
    await expect(codes(page)).toHaveText(['Banque principale']);
    expect(
      new URL(api.callsTo('accounting/journals/').at(-1)!.url()).searchParams.get('journal_type'),
    ).toBe('bank');

    await page.getByRole('link', { name: 'Banque principale' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Banque principale');
    await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' })).toContainText(
      'BQ1 — Banque principale',
    );
    expect(await axe(page)).toEqual([]);

    await page.goto('/app/comptabilite/journaux/nouveau');
    await page
      .getByRole('textbox', { name: 'Nom du journal', exact: true })
      .fill('Banque secondaire');
    await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'Banque' });
    await page.getByRole('textbox', { name: 'Code court', exact: true }).fill('BQ2');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Journal « BQ2 » créé.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Banque secondaire');

    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Désactiver' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Désactiver' }).click();
    await expect(page.getByText('Journal désactivé.')).toBeVisible();
    await expect(page.locator('alco-page-header')).toContainText('Inactif');
  });

  test('comme Odoo : colonnes, compte par défaut, « Actif » depuis la ligne', async ({ page }) => {
    await page.goto('/app/comptabilite/journaux');
    await expect(page.locator('thead th')).toHaveText([
      'Nom du journal',
      'Type',
      'Code court',
      'Compte',
      'Devise',
      'Actif',
    ]);
    const purchases = page.locator('tbody tr').filter({
      has: page.getByRole('link', { name: 'Achats', exact: true }),
    });
    await expect(purchases).toContainText('ACH');
    await expect(purchases).toContainText('601 Achats de marchandises');
    const sales = page.getByRole('switch', { name: 'Journal VTE actif' });
    await sales.click();
    await expect(page.getByText('Journal VTE désactivé.')).toBeVisible();
    await expect(sales).not.toBeChecked();
    expect(await axe(page)).toEqual([]);
  });

  test('journaux usuels en un clic : Ventes, Achats, Opérations diverses', async ({
    page,
    api,
  }) => {
    api.withCompanies(
      [{ company: COMPANY_B, permissions: PROFILES.accountant }],
      COMPANY_B.public_id,
    );
    await page.goto('/app/comptabilite/journaux');
    await page.getByRole('button', { name: 'Créer les journaux usuels' }).click();
    await expect(page.getByText('3 journaux usuels créés : VTE, ACH, OD.')).toBeVisible();
    // By code: ACH, OD, SN-VTE, VTE.
    await expect(codes(page)).toHaveText([
      'Achats',
      'Opérations diverses',
      'Ventes Dakar',
      'Ventes',
    ]);
    // No default account is chosen for the company.
    const sales = page.locator('tbody tr').filter({
      has: page.getByRole('link', { name: 'Ventes', exact: true }),
    });
    await expect(sales).not.toContainText('701');

    await page.getByRole('button', { name: 'Créer les journaux usuels' }).click();
    await expect(page.getByText('Les journaux usuels existent déjà.')).toBeVisible();
  });

  test('nouveau journal : un compte pour la banque et la caisse seulement', async ({ page }) => {
    await page.goto('/app/comptabilite/journaux/nouveau');
    await page
      .getByRole('textbox', { name: 'Nom du journal', exact: true })
      .fill('Achats importés');
    await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'Achats' });
    await page.getByRole('textbox', { name: 'Code court', exact: true }).fill('ACI');
    // Sales and purchase journals have no account (note backend 0038).
    const account = page.getByRole('combobox', { name: /^Compte/ });
    await expect(account).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Journal « ACI » créé.')).toBeVisible();

    // A bank journal: the list of the « Banque et caisse » accounts, « Aucun compte » first.
    await page.goto('/app/comptabilite/journaux/nouveau');
    await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'Banque' });
    await expect(account.locator('option').first()).toHaveText('Aucun compte');

    // Miscellaneous operations: no default account.
    await page.goto('/app/comptabilite/journaux/nouveau');
    await page.getByRole('combobox', { name: 'Type' }).selectOption({
      label: 'Opérations diverses',
    });
    await expect(page.locator('alco-autocomplete')).toHaveCount(0);
  });

  test('le code court se modifie sur la page du journal', async ({ page, api }) => {
    const purchases = api.accounting.books('A').journals.find((item) => item.code === 'ACH')!;
    await page.goto(`/app/comptabilite/journaux/${purchases.public_id}/modifier`);
    const code = page.getByRole('textbox', { name: 'Code court', exact: true });
    await expect(code).toHaveValue('ACH');
    await code.fill('achl');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
    await expect(page.locator('.facts')).toContainText('ACHL');
  });

  test('un journal de banque est son compte : coordonnées bancaires et solde d’ouverture', async ({
    page,
    api,
  }) => {
    const bank = api.accounting.books('A').journals.find((item) => item.code === 'BQ1')!;
    await page.goto(`/app/comptabilite/journaux/${bank.public_id}`);
    const section = page.getByRole('region', { name: 'Compte bancaire' });
    await expect(section).toContainText('Banque test');
    await expect(section).toContainText('GN00TEST00012345678');
    await expect(section).toContainText(/Solde d’ouverture\s*1\s000\s000 GNF/);

    await page.locator('alco-page-header').getByRole('link', { name: 'Modifier' }).click();
    await expect(page.getByRole('group', { name: 'Compte bancaire' })).toBeVisible();
    await page.getByRole('textbox', { name: 'IBAN' }).fill('GN00TEST99');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Compte bancaire' })).toContainText('GN00TEST99');
    // The former treasury account screens lead to the journals.
    await page.goto('/app/comptabilite/tresorerie/comptes');
    await expect(page).toHaveURL(/\/app\/comptabilite\/journaux$/);
  });
});

test.describe('Comptabilité — plan comptable', () => {
  test('Scénario 4 : liste par code, hiérarchie dans la fiche', async ({ page, api }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan comptable');
    await expect(codes(page)).toHaveText([
      '4',
      '40',
      '401',
      '404',
      '41',
      '411',
      '6',
      '60',
      '601',
      '604',
    ]);
    // 20 par page par défaut, comme toutes les listes.
    expect(
      new URL(api.callsTo('accounting/accounts/')[0].url()).searchParams.get('page_size'),
    ).toBe('20');

    await page.getByRole('link', { name: '40', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '40 — Fournisseurs et comptes rattachés',
    );
    await expect(page.getByRole('link', { name: '4 — Comptes de tiers' })).toBeVisible();
    const children = page.getByRole('table', { name: 'Sous-comptes de 40' });
    await expect(children.locator('a.code')).toHaveText(['401', '404']);
    await children.getByRole('link', { name: '401' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('401 — Fournisseurs');
    await expect(page.getByText('Aucun sous-compte.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('Scénario 5 : recherche du serveur, gardée dans l’URL', async ({ page, api }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    await expect(codes(page)).toHaveCount(10);
    await page.getByRole('searchbox', { name: 'Rechercher un compte' }).fill('fournisseurs');
    await expect(page).toHaveURL(/q=fournisseurs/);
    await expect(codes(page)).toHaveText(['40', '401', '404']);
    expect(
      new URL(api.callsTo('accounting/accounts/').at(-1)!.url()).searchParams.get('search'),
    ).toBe('fournisseurs');
  });

  test('Scénario 6 : filtre État (plus d’« Imputable »), regroupement par groupe', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    await page.getByRole('button', { name: 'Filtres' }).click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await expect(panel.getByLabel('Imputable')).toHaveCount(0);
    await panel.getByLabel('État').selectOption({ label: 'Actif' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/etat=active/);

    await page.getByRole('button', { name: 'Regrouper' }).click();
    await page.getByRole('menuitemradio', { name: 'Groupe', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Groupe 40/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Groupe 60/ })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('groupes de comptes par début de code, comme Odoo : un filtre, jamais un parent', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    const panel = page.getByRole('navigation', { name: 'Groupes de comptes par début de code' });
    await expect(panel.getByRole('button', { name: /^Tous/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(panel.getByRole('button', { name: /^4\s*6$/ })).toBeVisible();
    await panel.getByRole('button', { name: 'Déplier 4' }).click();
    await panel.getByRole('button', { name: /^41\s*2$/ }).click();
    await expect(page).toHaveURL(/prefixe=41/);
    await expect(codes(page)).toHaveText(['41', '411']);
    // The currency (empty: any); no company column (always the active company).
    const header = page.locator('thead');
    await expect(header).toContainText('Devise');
    await expect(header).not.toContainText('Société');
    await panel.getByRole('button', { name: /^Tous/ }).click();
    await expect(page).not.toHaveURL(/prefixe=/);
    expect(await axe(page)).toEqual([]);
  });

  test('formulaire : le type selon le code (SYSCOHADA), le lettrage d’office ; fiche et liste', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/plan-comptable/nouveau');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouveau compte');
    // The fields kept for Guinea: no class, description, parent, company nor journals.
    for (const gone of [
      'Classe',
      'Description',
      'Compte parent',
      'Saisie d’écritures',
      'Société',
      'Journaux autorisés',
    ]) {
      await expect(page.locator('form')).not.toContainText(gone);
    }
    await page.getByLabel('Code').fill('401100');
    await page.getByLabel('Nom du compte').fill('Fournisseurs locaux');
    const type = page.locator('select[formcontrolname="detailed_type"]');
    await expect(type.locator('optgroup')).toHaveCount(8);
    // Left « Selon le code »: the server gives « Fournisseur » and letters the account.
    await expect(type).toHaveValue('');
    await page.locator('select[formcontrolname="currency"]').selectOption('GNF');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('401100');
    await expect(page.getByText('Fournisseur', { exact: true }).first()).toBeVisible();
    const facts = page.locator('dl.facts').first();
    await expect(facts).toContainText(/Autoriser le lettrage\s*Oui/);
    await expect(facts).not.toContainText('Société');
    await page.goto('/app/comptabilite/plan-comptable?prefixe=4011');
    await expect(page.locator('tbody tr').first()).toContainText('Fournisseur');
    await expect(page.locator('tbody tr').first()).toContainText('GNF');
    await expect(
      page.getByRole('switch', { name: 'Autoriser le lettrage du compte 401100' }),
    ).toBeChecked();
  });
});

test.describe('Comptabilité — exercices, société, permissions, téléphone', () => {
  test('une écriture datée de 2027 s’enregistre : son exercice se crée tout seul', async ({
    page,
    api,
  }) => {
    // No fiscal year screen: nobody creates them, nobody sees them (note backend 0035).
    await page.goto('/app/comptabilite/tableau-de-bord');
    await moduleNav(page).getByRole('button', { name: 'Configuration' }).click();
    await expect(page.getByRole('menuitemradio', { name: /Exercices/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await createEntry(page, {
      date: '2027-02-10',
      description: 'Achat de février 2027',
      lines: [
        ['601', 'Débit', '500000'],
        ['401', 'Crédit', '500000'],
      ],
    });

    // Booked in the fiscal year the server opened for the date, with its twelve periods.
    await expect(page.getByText('2027 · 2027-02')).toBeVisible();
    const books = api.accounting.books('A');
    const opened = books.years.find((year) => year.code === '2027');
    expect(books.periods.filter((item) => item.fiscal_year === opened?.public_id)).toHaveLength(12);
  });

  test('Scénario 7 : changer de société — rien de l’ancienne ne reste', async ({ page, api }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    await expect(codes(page)).toHaveCount(10);
    await companyButton(page).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/plan-comptable$/);
    await expect(codes(page)).toHaveText(['7', '701']);
    // A's accounts are gone (« Fournisseurs » stays a link of the navigation).
    await expect(page.getByRole('table').getByText('Fournisseurs')).toHaveCount(0);

    await openMenuItem(page, 'Configuration', 'Journaux');
    await expect(codes(page)).toHaveText(['Ventes Dakar']);
    await moduleNav(page).getByRole('link', { name: 'Tableau de bord' }).click();
    await expect(
      page.getByRole('button', { name: /Société active : FILIALE SÉNÉGAL \(test\)/ }),
    ).toBeVisible();
    await expect(page.locator('.card-title')).toHaveText(['Ventes Dakar']);
    const last = api.callsTo('accounting/journals/').at(-1)!;
    expect(await last.headerValue('x-company-id')).toBe(COMPANY_B.public_id);
  });

  test('Scénario 8 : sans permission — ni tuile, ni écran, ni action', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, ['partners.read']);
    await page.goto('/app');
    await expect(page.locator('.tile-label')).not.toContainText(['Comptabilité']);
    await page.goto('/app/comptabilite/journaux');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByText('Vous n’avez pas accès à l’application Comptabilité dans cette société.'),
    ).toBeVisible();
    expect(api.callsTo('accounting/journals/')).toHaveLength(0);
  });

  test('lecture seule : ni création, ni modification', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, ['accounting.read']);
    await page.goto('/app/comptabilite/journaux');
    await expect(codes(page)).toHaveCount(6);
    await expect(page.getByRole('link', { name: 'Nouveau journal' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Achats', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0);
    await page.goto('/app/comptabilite/plan-comptable/nouveau');
    await expect(page.getByText('Votre profil ne permet pas d’ouvrir cet écran.')).toBeVisible();
  });

  test('Scénario 9 : téléphone — menu du module, tableaux dans leur cadre', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    for (const url of [
      '/app/comptabilite/tableau-de-bord',
      '/app/comptabilite/journaux',
      '/app/comptabilite/plan-comptable',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Navigation Comptabilité :/ })).toBeVisible();
      expect(await overflow(), url).toBeLessThanOrEqual(0);
    }
  });
});
