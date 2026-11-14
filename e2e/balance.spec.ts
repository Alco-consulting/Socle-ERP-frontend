import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

/**
 * Comptabilité › Analyse › Balance comptable, as Odoo's (notes backend 0051, 0052): its bar,
 * its columns, the date menu, the comparison, the drafts, the ⋮ of an account, PDF and XLSX.
 * Fake API only; today is 4 October 2026.
 */

const BALANCE = '/app/comptabilite/analyse/balance';
const bar = (page: Page) => page.locator('.report-bar');
const accounts = (page: Page) => page.locator('tbody th.account');
const lastCall = (api: { callsTo(path: string): { url(): string }[] }) =>
  new URL(api.callsTo('reporting/balance/').at(-1)!.url()).searchParams;

test.describe('Analyse › Balance comptable (comme Odoo)', () => {
  test.beforeEach(async ({ page }) => {
    await fixToday(page);
  });

  test('la barre et les colonnes d’Odoo, sur le mois en cours ; le bandeau des brouillons', async ({
    page,
    api,
  }) => {
    await page.goto(BALANCE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Balance comptable');
    await expect(accounts(page).first()).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /PDF/ })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /XLSX/ })).toBeVisible();
    await expect(bar(page)).toContainText('Pièces comptabilisées, Comptabilité d’engagement');
    await expect(page.locator('.heads th')).toHaveText([
      'Solde initial',
      'oct. 2026',
      'Solde final',
    ]);
    expect([lastCall(api).get('date_from'), lastCall(api).get('date_to')]).toEqual([
      '2026-10-01',
      '2026-10-31',
    ]);
    // La balance à six colonnes : chaque solde en débiteur ou créditeur, jamais de signe moins.
    await expect(page.locator('.subheads th')).toHaveText([
      'Compte',
      'Débiteur',
      'Créditeur',
      'Débit',
      'Crédit',
      'Débiteur',
      'Créditeur',
    ]);
    await expect(page.locator('tbody td').filter({ hasText: /^\s*-/ })).toHaveCount(0);
    // Une balance s'équilibre : les débits égalent les crédits. Les totaux des soldes viendront
    // du serveur ; d'ici là, leurs cellules restent vides et une note le dit.
    const total = await page.locator('tfoot td').allInnerTexts();
    expect([total[0], total[1], total[2] === total[3], total[4], total[5]]).toEqual([
      '',
      '',
      true,
      '',
      '',
    ]);
    await expect(page.locator('.totals-note')).toBeVisible();

    const banner = page.getByRole('note').filter({ hasText: 'pièces non comptabilisées' });
    await expect(banner).toHaveText(
      'Il y a des pièces non comptabilisées avant ou au cours de cette période.',
    );
    await expect(banner.getByRole('link')).toHaveAttribute(
      'href',
      '/app/comptabilite/ecritures?etat=draft&au=2026-10-31',
    );
  });

  test('le menu des dates : le mois précédent, puis la comparaison avec lui', async ({
    page,
    api,
  }) => {
    await page.goto(BALANCE);
    await expect(accounts(page).first()).toBeVisible();

    await bar(page).getByRole('button', { name: 'oct. 2026' }).click();
    const dates = page.getByRole('dialog', { name: 'Période' });
    await expect(dates).toContainText('octobre 2026');
    await dates.getByRole('button', { name: 'Mois précédent' }).click();
    await expect(page).toHaveURL(/date=2026-09-01/);
    await expect(bar(page).getByRole('button', { name: 'sept. 2026' })).toBeVisible();
    expect(lastCall(api).get('date_from')).toBe('2026-09-01');
    await page.keyboard.press('Escape');

    await bar(page).getByRole('button', { name: 'Comparaison' }).click();
    await page
      .getByRole('dialog', { name: 'Comparaison' })
      .getByRole('button', { name: 'Période précédente' })
      .click();
    await expect(page).toHaveURL(/comparaison=precedente/);
    await expect(page.locator('.heads th')).toHaveText([
      'Solde initial',
      'août 2026',
      'sept. 2026',
      'Solde final',
    ]);
    expect([lastCall(api).getAll('column_from'), lastCall(api).getAll('column_to')]).toEqual([
      ['2026-08-01'],
      ['2026-08-31'],
    ]);
    await expect(bar(page)).toContainText('Comparaison: Période précédente');
  });

  test('les écritures brouillon incluses, puis la hiérarchie et ses sous-totaux', async ({
    page,
    api,
  }) => {
    await page.goto(BALANCE);
    await expect(accounts(page).first()).toBeVisible();

    await page.getByRole('button', { name: 'Pièces et options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Écritures brouillon' }).click();
    await expect(page).toHaveURL(/brouillons=oui/);
    await expect(bar(page)).toContainText('Toutes les pièces, Comptabilité d’engagement');
    await expect(page.getByRole('note').filter({ hasText: 'non comptabilisées' })).toHaveCount(0);
    expect(lastCall(api).get('include_unposted')).toBe('true');

    await page.getByRole('button', { name: 'Pièces et options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Hiérarchie et sous-totaux' }).click();
    const tiers = page.getByRole('button', { name: /^4 Comptes de tiers$/ });
    await expect(tiers).toHaveAttribute('aria-expanded', 'true');
    const before = await accounts(page).count();
    await tiers.click();
    await expect(tiers).toHaveAttribute('aria-expanded', 'false');
    expect(await accounts(page).count()).toBeLessThan(before);
  });

  test('le ⋮ d’un compte mène à son grand livre général sur la même période', async ({ page }) => {
    await page.goto(BALANCE);
    const account = accounts(page).first();
    await expect(account).toBeVisible();
    const code = (await account.locator('.code').innerText()).trim();

    await account.getByRole('button', { name: `Actions du compte ${code}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Écritures comptables' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Grand livre général' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/analyse/grand-livre\\?compte=${code}&date=2026-10-04$`),
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand livre général');
  });

  test('PDF et XLSX : la même balance, téléchargée', async ({ page, api }) => {
    await page.goto(`${BALANCE}?journal=VTE`);
    await expect(accounts(page).first()).toBeVisible();

    const pdf = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger la balance en PDF' }).click();
    expect((await pdf).suggestedFilename()).toBe('reporting-balance.pdf');
    const xlsx = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger la balance en Excel (XLSX)' }).click();
    expect((await xlsx).suggestedFilename()).toBe('reporting-balance.xlsx');
    const bodies = api
      .callsTo('imports-exports/exports/')
      .map(
        (call) => call.postDataJSON() as { file_format: string; parameters: { journal: string[] } },
      );
    const vte = api.accounting.books('A').journals.find((item) => item.code === 'VTE')!;
    expect(bodies.map((body) => body.file_format)).toEqual(['pdf', 'xlsx']);
    expect(bodies[0].parameters.journal).toEqual([vte.public_id]);
  });
});
