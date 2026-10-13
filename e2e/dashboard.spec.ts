import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, COMPANY_B, PROFILES, expect, test } from './support/fake-api';
import { fixToday, moduleNav } from './support/navigation';

/**
 * Comptabilité › Tableau de bord, as Odoo's (note backend 0042), on the fake API: one card per
 * active journal from `dashboards/journals/`. Nothing reaches the real API.
 */

const titles = (page: Page) => page.locator('.card-title');
const card = (page: Page, name: string) =>
  page.locator('.card').filter({ has: page.locator('.card-title', { hasText: name }) });
const rows = (page: Page) => page.locator('tbody tr');

test.beforeEach(async ({ page }) => {
  await fixToday(page);
});

test.describe('Tableau de bord comptable — comme Odoo', () => {
  test('lanceur → Comptabilité → tableau de bord : une carte par journal, dans l’ordre d’Odoo', async ({
    page,
    api,
  }) => {
    await page.goto('/app');
    await page.getByRole('link', { name: /Comptabilité/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tableau de bord');
    await expect(titles(page)).toHaveText([
      'Caisse',
      'Banque principale',
      'Ventes',
      'Achats',
      'Opérations diverses',
    ]);
    await expect(page.getByText('À surveiller')).toHaveCount(0);

    // One request for every journal, with the day; nothing rebuilt, no alert.
    await page.waitForLoadState('networkidle');
    const journals = api.callsTo('dashboards/journals/');
    expect(journals).toHaveLength(1);
    expect(new URL(journals[0].url()).searchParams.get('on')).toBe('2026-10-04');
    expect(api.callsTo('dashboards/alerts/')).toHaveLength(0);
    expect(api.callsTo('accounting/entries/')).toHaveLength(0);
    expect(await journals[0].headerValue('x-company-id')).toBe(COMPANY_A.public_id);
  });

  test('banque : Transactions, solde, courbe et éléments à rapprocher', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const bank = card(page, 'Banque principale');
    await expect(bank.locator('.figures')).toContainText(/Solde\s*25\s480\s000\s+GNF/);
    await expect(bank.getByRole('img', { name: /^Solde sur 30 jours/ })).toBeVisible();
    await expect(bank.locator('.dot')).toHaveCount(3);
    await expect(bank.getByRole('link', { name: 'Rapprocher 3 éléments' })).toHaveAttribute(
      'href',
      '/app/comptabilite/tresorerie/rapprochements',
    );
    await expect(card(page, 'Caisse').locator('.figures')).toContainText(/1\s250\s000\s+GNF/);
    await expect(card(page, 'Caisse').getByRole('link', { name: /^Rapprocher/ })).toHaveCount(0);

    await bank.getByRole('link', { name: 'Transactions — Banque principale' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tresorerie\/transactions\?compte=BANK-GNF$/);
  });

  test('ventes : Nouveau, À valider, Non payés et les six semaines d’échéance', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const sales = card(page, 'Ventes');
    await expect(sales.locator('.figure')).toHaveText([
      /^1 À valider\s*1\s180\s000 GNF\s*$/,
      /^2 Non payés\s*60\s331\s200 GNF\s*$/,
    ]);
    await expect(sales.locator('.bar-label')).toHaveText([
      'Dû',
      '21 - 27 sept.',
      'Cette semaine',
      '5 - 11 oct.',
      '12 - 18 oct.',
      'Pas dû',
    ]);
    // Nothing to count in the purchases: nothing said, the bars stay.
    await expect(card(page, 'Achats').locator('.figure')).toHaveCount(0);
    await expect(card(page, 'Achats').locator('.bar')).toHaveCount(6);

    await sales.getByRole('link', { name: '1 À valider' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ventes\/factures\?etat=draft$/);
    await page.goBack();
    await card(page, 'Ventes').getByRole('link', { name: 'Nouveau — Ventes' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ventes\/factures\/nouvelle$/);
  });

  test('opérations diverses : Nouveau dans le journal, brouillons de la même taille', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    const general = card(page, 'Opérations diverses');
    const drafts = general.getByRole('link', { name: /^\d+ Brouillons?$/ });
    const count = Number((await drafts.textContent())?.trim().split(' ')[0]);
    await drafts.click();
    await expect(page).toHaveURL(/\/ecritures\/pieces\?journal=[^&]+&etat=draft$/);
    await expect(rows(page)).toHaveCount(count);

    await page.goBack();
    // Entered by hand in miscellaneous operations only (note backend 0038).
    await expect(page.getByRole('link', { name: 'Nouveau — Caisse' })).toHaveCount(0);
    await card(page, 'Opérations diverses')
      .getByRole('link', { name: 'Nouveau — Opérations diverses' })
      .click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/nouvelle\?journal=/);
    await expect(page.getByLabel('Journal').locator('option:checked')).toHaveText(
      /^\s*OD — Opérations diverses/,
    );
  });

  test('menu ⋮ d’une carte : les écritures et la configuration du journal', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await card(page, 'Ventes').getByRole('button', { name: 'Actions du journal Ventes' }).click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Voir les écritures',
      'Configuration du journal',
    ]);
    await page.getByRole('menuitem', { name: 'Configuration du journal' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/journaux\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ventes');
  });

  test('lecture seule, sans trésorerie ni facturation : ni solde, ni courbe, ni Nouveau', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(titles(page)).toHaveCount(5);
    await expect(page.locator('.figures', { hasText: 'Solde' })).toHaveCount(0);
    await expect(page.locator('alco-balance-curve')).toHaveCount(0);
    await expect(page.locator('alco-due-bars')).toHaveCount(0);
    await expect(page.getByText(/Aucun compte de trésorerie/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Nouveau/ })).toHaveCount(0);
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

  test('changement de société : les journaux de l’autre société', async ({ page, api }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(titles(page)).toHaveCount(5);
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/tableau-de-bord$/);
    await expect(titles(page)).toHaveText(['Ventes Dakar']);
    const last = api.callsTo('dashboards/journals/').at(-1)!;
    expect(await last.headerValue('x-company-id')).toBe(COMPANY_B.public_id);
  });

  test('accessibilité : tableau de bord et menu d’une carte sans violation', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(titles(page)).toHaveCount(5);
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((violation) => violation.id);
    expect(await scan()).toEqual([]);
    // Keyboard: the card's menu opens and closes without a mouse.
    const menu = card(page, 'Achats').getByRole('button', { name: 'Actions du journal Achats' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Voir les écritures' })).toBeFocused();
    expect(await scan()).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
  });
});
