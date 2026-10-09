import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, COMPANY_B, expect, test } from './support/fake-api';
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
    await expect(page.getByText('ALCO GUINÉE (test) · Exercice : Exercice 2026')).toBeVisible();
    await expect(page.getByRole('note', { name: 'Démonstration' })).toHaveCount(0);

    // Entries waiting, per journal, as dashboards/journals/ counts them (12 drafts, 4 submitted).
    const total = async (label: string) => {
      const links = page.getByRole('link', { name: new RegExp(`^${label} : \\d+$`) });
      await expect(links).toHaveCount(5);
      const names = await links.evaluateAll((all) => all.map((link) => link.ariaLabel ?? ''));
      return names.reduce((sum, name) => sum + Number(name.split(': ')[1]), 0);
    };
    expect(await total('Brouillons')).toBe(12);
    expect(await total('Soumises')).toBe(4);
    await expect(page.getByRole('list', { name: 'Périodes de Exercice 2026' })).toContainText(
      /Janvier 2026\s*Clôturée/,
    );
    const journals = page.locator('.journal-code');
    await expect(journals).toHaveText(['ACH', 'BQ1', 'CAI', 'OD', 'VTE']);
    await expect(page.locator('alco-card', { hasText: 'Plan comptable' })).toContainText(
      /Comptes\s*10.*Comptes imputables\s*4/s,
    );

    // A fixed number of requests: no request per journal or per period. Accounting: open
    // fiscal years, their periods, the chart's two counts; the journals: one dashboards call.
    const accounting = () =>
      api.calls.filter((call) => new URL(call.url()).pathname.startsWith('/api/v1/accounting/'));
    await expect.poll(() => accounting().length).toBe(4);
    await page.waitForLoadState('networkidle');
    expect(accounting()).toHaveLength(4);
    expect(api.callsTo('dashboards/journals/')).toHaveLength(1);
    for (const call of accounting()) {
      expect(await call.headerValue('x-company-id')).toBe(COMPANY_A.public_id);
    }
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('Comptabilité — journaux', () => {
  test('Scénario 3 : liste, filtre, fiche, création, désactivation', async ({ page, api }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Comptabilité', 'Journaux');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Journaux');
    await expect(codes(page)).toHaveText(['ACH', 'ANC', 'BQ1', 'CAI', 'OD', 'VTE']);
    await expect(page.getByRole('row', { name: /ANC/ })).toContainText('Inactif');

    await page.getByRole('button', { name: 'Filtres' }).click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('Type').selectOption({ label: 'Banque' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/type=bank/);
    await expect(codes(page)).toHaveText(['BQ1']);
    expect(
      new URL(api.callsTo('accounting/journals/').at(-1)!.url()).searchParams.get('journal_type'),
    ).toBe('bank');

    await page.getByRole('link', { name: 'BQ1' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Banque principale');
    await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' })).toContainText(
      'BQ1 — Banque principale',
    );
    expect(await axe(page)).toEqual([]);

    await page.goto('/app/comptabilite/journaux/nouveau');
    await page.getByRole('textbox', { name: 'Code', exact: true }).fill('BQ2');
    await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Banque secondaire');
    await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'Banque' });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Journal « BQ2 » créé.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Banque secondaire');

    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Désactiver' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Désactiver' }).click();
    await expect(page.getByText('Journal désactivé.')).toBeVisible();
    await expect(page.locator('alco-page-header')).toContainText('Inactif');
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
    expect(
      new URL(api.callsTo('accounting/accounts/')[0].url()).searchParams.get('page_size'),
    ).toBe('50');

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

  test('Scénario 6 : filtres État et Imputable, regroupement par classe', async ({ page }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    await page.getByRole('button', { name: 'Filtres' }).click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('Imputable').selectOption({ label: 'Imputables' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/imputable=oui/);
    // Postable as the server decides: active, entries allowed, no sub-account.
    await expect(codes(page)).toHaveText(['401', '404', '411', '601']);

    await page.getByRole('button', { name: 'Regrouper' }).click();
    await page.getByRole('menuitemradio', { name: 'Classe' }).click();
    await expect(page.getByRole('button', { name: /^Classe 4/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Classe 6/ })).toBeVisible();
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
    // The new columns: the currency (empty: any) and the active company.
    const header = page.locator('thead');
    await expect(header).toContainText('Devise');
    await expect(header).toContainText('Société');
    await expect(page.locator('tbody tr').first()).toContainText(COMPANY_A.trade_name);
    await panel.getByRole('button', { name: /^Tous/ }).click();
    await expect(page).not.toHaveURL(/prefixe=/);
    expect(await axe(page)).toEqual([]);
  });

  test('formulaire comme Odoo : type groupé, journaux autorisés, devise ; fiche et liste', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/plan-comptable/nouveau');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouveau compte');
    // Only Odoo's fields: no class, description, parent nor « saisie autorisée ».
    for (const gone of ['Classe', 'Description', 'Compte parent', 'Saisie d’écritures']) {
      await expect(page.locator('form')).not.toContainText(gone);
    }
    await page.getByLabel('Code').fill('401100');
    await page.getByLabel('Nom du compte').fill('Fournisseurs locaux');
    const type = page.locator('select[formcontrolname="detailed_type"]');
    await expect(type.locator('optgroup')).toHaveCount(8);
    await type.selectOption({ label: 'Fournisseur' });
    await page.locator('select[formcontrolname="currency"]').selectOption('GNF');
    await page.getByRole('checkbox', { name: /^VTE/ }).check();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('401100');
    await expect(page.getByText('Fournisseur', { exact: true }).first()).toBeVisible();
    const facts = page.locator('dl.facts').first();
    await expect(facts).toContainText('VTE');
    await expect(facts).toContainText(COMPANY_A.trade_name);
    await page.goto('/app/comptabilite/plan-comptable?prefixe=4011');
    await expect(page.locator('tbody tr').first()).toContainText('Fournisseur');
    await expect(page.locator('tbody tr').first()).toContainText('GNF');
  });
});

test.describe('Comptabilité — exercices, société, permissions, téléphone', () => {
  test('exercices et périodes : les états du serveur', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await moduleNav(page).getByRole('button', { name: 'Configuration' }).click();
    await page.getByRole('menuitemradio', { name: 'Exercices et périodes' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Exercices et périodes');
    await expect(page.getByRole('button', { name: /Exercice 2026/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('row', { name: /Janvier 2026/ })).toContainText('Clôturée');
    await expect(page.getByRole('row', { name: /Mars 2026/ })).toContainText('Ouverte');
    await page.getByRole('button', { name: /Exercice 2025/ }).click();
    await expect(page).toHaveURL(/exercice=/);
    await expect(page.getByRole('row', { name: /Juin 2025/ })).toContainText('Clôturée');
    expect(await axe(page)).toEqual([]);
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

    await openMenuItem(page, 'Comptabilité', 'Journaux');
    await expect(codes(page)).toHaveText(['SN-VTE']);
    await moduleNav(page).getByRole('link', { name: 'Tableau de bord' }).click();
    await expect(page.getByText('FILIALE SÉNÉGAL (test) · Exercice : Exercice 2026')).toBeVisible();
    await expect(page.locator('.journal-code')).toHaveText(['SN-VTE']);
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
    await page.getByRole('link', { name: 'ACH' }).click();
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
      '/app/comptabilite/configuration/exercices',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Navigation Comptabilité :/ })).toBeVisible();
      expect(await overflow(), url).toBeLessThanOrEqual(0);
    }
  });
});
