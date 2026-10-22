import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

/**
 * Comptabilité › Analyse › Balance générale, as Odoo's (note backend 0051): six columns,
 * the filters of the URL, the hierarchy, the menu of an account, the workbook. Fake API only.
 */

const BALANCE = '/app/comptabilite/analyse/balance';
const totals = (page: Page) => page.locator('tfoot td');
const accounts = (page: Page) => page.locator('tbody th.account');

test.describe('Analyse › Balance générale (comme Odoo)', () => {
  test.beforeEach(async ({ page }) => {
    await fixToday(page);
  });

  test('six colonnes équilibrées ; les brouillons signalés puis inclus', async ({ page, api }) => {
    await page.goto(BALANCE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Balance générale');
    await expect(page.getByRole('columnheader', { name: 'Solde initial' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Exercice 2026' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Solde final' })).toBeVisible();
    await expect(accounts(page).first()).toBeVisible();
    // Debits equal credits, and so do the closing balances on their two sides.
    const cells = await totals(page).allInnerTexts();
    expect(cells[2]).toBe(cells[3]);
    expect(cells[4]).toBe(cells[5]);
    const first = new URL(api.callsTo('reporting/balance/').at(-1)!.url()).searchParams;
    expect([first.get('date_from'), first.get('date_to')]).toEqual(['2026-01-01', '2026-12-31']);

    const warning = page.getByRole('note').filter({ hasText: 'non comptabilisée' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Les inclure' }).click();
    await expect(page).toHaveURL(/brouillons=oui/);
    await expect(warning).toHaveCount(0);
    const included = new URL(api.callsTo('reporting/balance/').at(-1)!.url()).searchParams;
    expect(included.get('include_unposted')).toBe('true');
    await expect(page.getByText('Écritures non comptabilisées comprises.')).toBeVisible();
  });

  test('un journal choisi, puis la hiérarchie et ses sous-totaux', async ({ page, api }) => {
    await page.goto(BALANCE);
    await expect(accounts(page).first()).toBeVisible();

    await page.getByRole('button', { name: 'Journaux' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'ACH — Achats' }).click();
    await expect(page).toHaveURL(/journal=ACH/);
    await expect(page.getByRole('button', { name: 'Journaux' })).toContainText('Journaux : ACH');
    const ach = api.accounting.books('A').journals.find((item) => item.code === 'ACH')!;
    const call = new URL(api.callsTo('reporting/balance/').at(-1)!.url()).searchParams;
    expect(call.getAll('journal')).toEqual([ach.public_id]);

    await page.getByRole('button', { name: 'Options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Hiérarchie et sous-totaux' }).click();
    await expect(page).toHaveURL(/hierarchie=oui/);
    const tiers = page.getByRole('button', { name: /^4 Comptes de tiers$/ });
    await expect(tiers).toHaveAttribute('aria-expanded', 'true');
    const before = await accounts(page).count();
    await tiers.click();
    await expect(tiers).toHaveAttribute('aria-expanded', 'false');
    expect(await accounts(page).count()).toBeLessThan(before);
  });

  test('un compte mène à son grand livre sur la même période', async ({ page, api }) => {
    await page.goto(`${BALANCE}?periode=trimestre`);
    const account = accounts(page).first();
    await expect(account).toBeVisible();
    const code = (await account.locator('.code').innerText()).trim();

    await account.getByRole('button').click();
    await expect(page.getByRole('menuitem', { name: 'Écritures comptables' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Grand livre' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/analyse/grand-livre\\?compte=${code}&du=2026-10-01&au=2026-12-31$`),
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand livre');
    const ledger = api.calls.filter((item) => item.url().includes('/reporting/ledger/')).at(-1)!;
    expect(new URL(ledger.url()).searchParams.get('date_from')).toBe('2026-10-01');
  });

  test('XLSX : la même balance, téléchargée au format Excel', async ({ page, api }) => {
    await page.goto(`${BALANCE}?journal=VTE`);
    await expect(accounts(page).first()).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter la balance au format Excel (XLSX)' }).click();
    expect((await download).suggestedFilename()).toBe('reporting-balance.xlsx');
    const body = api.callsTo('imports-exports/exports/').at(-1)!.postDataJSON() as {
      export_type: string;
      file_format: string;
      parameters: { date_from: string; journal: string[] };
    };
    const vte = api.accounting.books('A').journals.find((item) => item.code === 'VTE')!;
    expect([body.export_type, body.file_format]).toEqual(['reporting.balance', 'xlsx']);
    expect([body.parameters.date_from, body.parameters.journal]).toEqual([
      '2026-01-01',
      [vte.public_id],
    ]);
  });
});
