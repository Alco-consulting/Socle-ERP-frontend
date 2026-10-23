import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

/**
 * Comptabilité › Analyse › Grand livre général, as Odoo's (note backend 0053): every account
 * and its totals, an account unfolded into its « Solde initial » and lines, the ⋮ of a line,
 * the way from the balance, PDF and XLSX. Fake API only; today is 4 October 2026.
 */

const LEDGER = '/app/comptabilite/analyse/grand-livre';
const accounts = (page: Page) => page.locator('tr.account-row');

test.describe('Analyse › Grand livre général (comme Odoo)', () => {
  test.beforeEach(async ({ page }) => {
    await fixToday(page);
  });

  test('chaque compte et ses totaux, sur l’année ; le total équilibré', async ({ page, api }) => {
    await page.goto(`${LEDGER}?periode=annee`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand livre général');
    await expect(accounts(page).first()).toBeVisible();
    await expect(page.locator('.heads th')).toHaveText(['2026']);
    const call = new URL(api.callsTo('reporting/general-ledger/').at(-1)!.url()).searchParams;
    expect([call.get('date_from'), call.get('date_to')]).toEqual(['2026-01-01', '2026-12-31']);
    const total = await page.locator('tfoot td').allInnerTexts();
    expect(total[2]).toBe(total[3]);
  });

  test('un compte déplié : son solde initial, ses lignes ; le ⋮ d’une ligne ouvre sa pièce', async ({
    page,
  }) => {
    await page.goto(`${LEDGER}?periode=annee`);
    const first = accounts(page).first();
    await expect(first).toBeVisible();

    const fold = first.locator('button.fold');
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('tr.initial th')).toHaveText('Solde initial');
    await expect(first.getByRole('link', { name: 'Écritures comptables' })).toBeVisible();
    const line = page.locator('tr.line').first();
    await expect(line).toBeVisible();
    await line.getByRole('button', { name: /Actions de la ligne/ }).click();
    await page.getByRole('menuitem', { name: 'Voir la pièce' }).click();
    await expect(page).toHaveURL(/\/ecritures\/[^/?#]+$/);
  });

  test('depuis la Balance, « Grand livre général » ouvre le compte, déplié', async ({ page }) => {
    await page.goto('/app/comptabilite/analyse/balance?periode=annee');
    const account = page.locator('tbody th.account').first();
    await expect(account).toBeVisible();
    const code = (await account.locator('.code').innerText()).trim();

    await account.getByRole('button', { name: `Actions du compte ${code}` }).click();
    await page.getByRole('menuitem', { name: 'Grand livre général' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand livre général');
    await expect(accounts(page)).toHaveCount(1);
    await expect(accounts(page).locator('button.fold')).toHaveAttribute('aria-expanded', 'true');
  });

  test('PDF et XLSX : le même grand livre, téléchargé', async ({ page, api }) => {
    await page.goto(`${LEDGER}?periode=annee`);
    await expect(accounts(page).first()).toBeVisible();

    const pdf = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le grand livre en PDF' }).click();
    expect((await pdf).suggestedFilename()).toBe('reporting-balance.pdf');
    const xlsx = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le grand livre en Excel (XLSX)' }).click();
    expect((await xlsx).suggestedFilename()).toBe('reporting-balance.xlsx');
    const bodies = api
      .callsTo('imports-exports/exports/')
      .map((call) => call.postDataJSON() as { export_type: string; file_format: string });
    expect(bodies.map((body) => [body.export_type, body.file_format])).toEqual([
      ['reporting.general_ledger', 'pdf'],
      ['reporting.general_ledger', 'xlsx'],
    ]);
  });
});
