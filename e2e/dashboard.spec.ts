import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, COMPANY_B, PROFILES, expect, test } from './support/fake-api';
import { fixToday, moduleNav } from './support/navigation';

/**
 * Comptabilité › Tableau de bord (V2.1) on the fake API: one card per active journal from
 * `dashboards/journals/`, alerts from `dashboards/alerts/`. Nothing reaches the real API.
 */

const card = (page: Page, code: string) =>
  page.locator('.journal').filter({ has: page.locator('.journal-code', { hasText: code }) });
const counter = (page: Page, code: string, label: string) =>
  card(page, code).getByRole('link', { name: new RegExp(`^${label} : \\d+$`) });
const countOf = async (page: Page, code: string, label: string) =>
  Number((await counter(page, code, label).getAttribute('aria-label'))?.split(': ')[1]);
const rows = (page: Page) => page.locator('tbody tr');

test.beforeEach(async ({ page }) => {
  await fixToday(page);
});

test.describe('Tableau de bord comptable — journaux et alertes de l’API', () => {
  test('lanceur → Comptabilité → tableau de bord : une carte par journal actif', async ({
    page,
    api,
  }) => {
    await page.goto('/app');
    await expect(page.locator('.tile-label', { hasText: 'Reporting' })).toHaveCount(0);
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tableau de bord');
    await expect(page.locator('.journal-code')).toHaveText(['ACH', 'BQ1', 'CAI', 'OD', 'VTE']);
    await expect(card(page, 'BQ1')).toContainText('Banque principale');
    await expect(card(page, 'BQ1')).toContainText('Banque · GNF');
    for (const label of ['Écritures', 'Brouillons', 'Soumises', 'Validées', 'Verrouillées']) {
      await expect(counter(page, 'ACH', label)).toBeVisible();
    }

    // One request for every journal, with the day of the balances; nothing rebuilt.
    await page.waitForLoadState('networkidle');
    const journals = api.callsTo('dashboards/journals/');
    expect(journals).toHaveLength(1);
    expect(new URL(journals[0].url()).searchParams.get('on')).toBe('2026-10-04');
    expect(api.callsTo('accounting/entries/')).toHaveLength(0);
    expect(await journals[0].headerValue('x-company-id')).toBe(COMPANY_A.public_id);
  });

  test('compteur Brouillons → la liste des brouillons du journal, de la même taille', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const drafts = await countOf(page, 'ACH', 'Brouillons');
    await counter(page, 'ACH', 'Brouillons').click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\?journal=[^&]+&etat=draft$/);
    await expect(rows(page)).toHaveCount(drafts);
    for (const row of await rows(page).all()) {
      await expect(row).toContainText('ACH');
      await expect(row).toContainText('Brouillon');
    }
  });

  test('compteur Soumises → les écritures soumises du journal ; clic vers l’écriture', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const submitted = await countOf(page, 'ACH', 'Soumises');
    expect(submitted).toBeGreaterThan(0); // the fake entries seed submitted purchases
    await counter(page, 'ACH', 'Soumises').click();
    await expect(page).toHaveURL(/etat=submitted$/);
    await expect(rows(page)).toHaveCount(submitted);
    await rows(page).first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/[^/?]+$/);
    // From the entry, back to its journal by its public id, with its smart buttons.
    await page.getByRole('link', { name: 'ACH', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/journaux\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achats');
    await expect(page.getByRole('link', { name: `Soumises : ${submitted}` })).toBeVisible();
  });

  test('nouvelle écriture depuis un journal : le journal est présélectionné', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await page.getByRole('link', { name: 'Nouvelle écriture dans le journal CAI' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/nouvelle\?journal=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouvelle écriture');
    await expect(page.getByLabel('Journal')).toHaveValue(/.+/);
    await expect(page.getByLabel('Journal').locator('option:checked')).toHaveText(
      /^\s*CAI — Caisse/,
    );
  });

  test('menu ⋮ d’une carte : seulement les actions qui existent', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await card(page, 'VTE').getByRole('button', { name: 'Actions du journal VTE' }).click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Voir les écritures',
      'Nouvelle écriture',
      'Configuration du journal',
    ]);
    await page.getByRole('menuitem', { name: 'Configuration du journal' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/journaux\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ventes');
  });

  test('trésorerie autorisée : solde du jour et lignes à rapprocher', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const bank = card(page, 'BQ1').getByRole('list', { name: 'Trésorerie du journal BQ1' });
    await expect(bank).toContainText('Compte courant BICIGUI');
    await expect(bank).toContainText(/25\s480\s000\s+GNF/);
    await expect(bank.getByRole('link', { name: '3 à rapprocher' })).toHaveAttribute(
      'href',
      '/app/comptabilite/tresorerie/rapprochements',
    );
    await expect(card(page, 'CAI')).toContainText(/1\s250\s000\s+GNF/);
    await expect(card(page, 'ACH').getByRole('list', { name: /Trésorerie/ })).toHaveCount(0);
    await expect(page.getByText('Soldes de trésorerie au 04/10/2026.')).toBeVisible();
  });

  test('trésorerie non autorisée (pas dashboards.read_treasury) : rien n’en est montré', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(page.locator('.journal-code')).toHaveText(['ACH', 'BQ1', 'CAI', 'OD', 'VTE']);
    await expect(page.locator('.treasury')).toHaveCount(0);
    await expect(page.getByText('Compte courant BICIGUI')).toHaveCount(0);
    await expect(page.getByText(/Soldes de trésorerie/)).toHaveCount(0);
    await expect(page.getByText(/Aucun compte de trésorerie/)).toHaveCount(0);
    // Read only: no new entry offered.
    await expect(page.getByRole('link', { name: /^Nouvelle écriture/ })).toHaveCount(0);
  });

  test('sans dashboards.read : pas de tableau de bord, la Comptabilité reste ouverte', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, ['accounting.read', 'partners.read']);
    await page.goto('/app/comptabilite');
    await expect(page).toHaveURL(/\/app\/comptabilite\/clients$/);
    await expect(moduleNav(page).getByRole('link', { name: 'Tableau de bord' })).toHaveCount(0);
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(
      page.getByText('Cet écran n’est pas disponible pour votre profil ou pour cette société.'),
    ).toBeVisible();
    expect(api.callsTo('dashboards/journals/')).toHaveLength(0);
  });

  test('alertes : celles que l’API renvoie, par code, cliquables quand l’écran existe', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const watch = page.getByRole('region', { name: 'À surveiller' });
    await expect(watch).toContainText(/Écritures non validées\s*Clôture 2026-09\s*Bloquant/);
    await expect(watch).toContainText(/Déclarations de taxes non validées\s*2/);
    await expect(watch).toContainText(/Imports en échec\s*1/);
    await expect(watch).not.toContainText('Server text');
    await expect(watch).not.toContainText('Échéances d’emprunt en retard'); // a zero count
    await expect(
      watch.getByRole('link', { name: 'Lignes de relevé à rapprocher' }),
    ).toHaveAttribute('href', '/app/comptabilite/tresorerie/rapprochements');
    await expect(watch.getByRole('link', { name: 'Imports en échec' })).toHaveCount(0);
    await expect(watch).toContainText('Du 01/01/2026 au 04/10/2026');
    await expect(watch).not.toContainText('FY2026');
    const alerts = api.callsTo('dashboards/alerts/');
    expect(alerts).toHaveLength(1);
    const query = new URL(alerts[0].url()).searchParams;
    expect([query.get('date_from'), query.get('date_to')]).toEqual(['2026-01-01', '2026-10-04']);
  });

  test('changement de société : les journaux et la trésorerie de l’autre société', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(card(page, 'BQ1')).toContainText('Compte courant BICIGUI');
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(page.locator('.journal-code')).toHaveText(['SN-VTE']);
    await expect(page.getByText('Compte courant BICIGUI')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'À surveiller' })).toContainText(
      'Rien à signaler.',
    );
    const last = api.callsTo('dashboards/journals/').at(-1)!;
    expect(await last.headerValue('x-company-id')).toBe(COMPANY_B.public_id);
  });

  test('accessibilité : tableau de bord et menu d’une carte sans violation', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(page.locator('.journal-code')).toHaveCount(5);
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((violation) => violation.id);
    expect(await scan()).toEqual([]);
    // Keyboard: the card's menu opens and closes without a mouse.
    await card(page, 'ACH').getByRole('button', { name: 'Actions du journal ACH' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Voir les écritures' })).toBeFocused();
    expect(await scan()).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(
      card(page, 'ACH').getByRole('button', { name: 'Actions du journal ACH' }),
    ).toBeFocused();
  });
});
