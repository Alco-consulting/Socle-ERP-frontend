import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

/**
 * Comptabilité › Analyse › Grand livre des partenaires, as Odoo's (note backend 0054): every
 * partner of the receivable and payable accounts, a partner unfolded into its « Solde
 * initial » and lines (journal, account, ref, due date, lettering), the accounts filter, PDF
 * and XLSX. Fake API only; today is 4 October 2026.
 */

const LEDGER = '/app/comptabilite/analyse/grand-livre-auxiliaire';
const partners = (page: Page) => page.locator('tr.account-row');
const lastCall = (api: { callsTo(path: string): { url(): string }[] }) =>
  new URL(api.callsTo('reporting/partner-ledger/').at(-1)!.url()).searchParams;

test.describe('Analyse › Grand livre des partenaires (comme Odoo)', () => {
  test.beforeEach(async ({ page }) => {
    await fixToday(page);
  });

  test('chaque partenaire des comptes de tiers, sur l’année ; ses colonnes', async ({
    page,
    api,
  }) => {
    await page.goto(`${LEDGER}?periode=annee`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand livre des partenaires');
    await expect(partners(page).first()).toBeVisible();
    await expect(page.locator('.report-bar')).toContainText('Comptes à recevoir et à payer');
    await expect(page.locator('.subheads th')).toHaveText([
      'Partenaire',
      'Date',
      'Journal',
      'Compte',
      'Réf.',
      'Échéance',
      'Lettrage',
      'Débit',
      'Crédit',
      'Solde',
    ]);
    expect([lastCall(api).get('date_from'), lastCall(api).get('date_to')]).toEqual([
      '2026-01-01',
      '2026-12-31',
    ]);
    expect(lastCall(api).getAll('tiers')).toEqual([]);
  });

  test('un partenaire déplié : son solde initial, ses lignes ; le ⋮ d’une ligne ouvre sa pièce', async ({
    page,
  }) => {
    await page.goto(`${LEDGER}?periode=annee`);
    const first = partners(page).first();
    await expect(first).toBeVisible();

    const fold = first.locator('button.fold');
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('tr.initial th')).toHaveText('Solde initial');
    await expect(first.getByRole('link', { name: 'Écritures comptables' })).toBeVisible();
    const line = page.locator('tr.line').first();
    await expect(line).toBeVisible();
    await expect(line.locator('td.code').nth(1)).toHaveText(/^4[01]1$/);
    await line.getByRole('button', { name: /Actions de la ligne/ }).click();
    await page.getByRole('menuitem', { name: 'Voir la pièce' }).click();
    await expect(page).toHaveURL(/\/ecritures\/[^/?#]+$/);
  });

  test('« Comptes à payer » seul : dans l’adresse et dans la demande', async ({ page, api }) => {
    await page.goto(`${LEDGER}?periode=annee`);
    await expect(partners(page).first()).toBeVisible();

    await page.getByRole('button', { name: 'Comptes de tiers' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Comptes à recevoir' }).click();
    await expect(page).toHaveURL(/comptes=payer/);
    await expect.poll(() => lastCall(api).getAll('tiers')).toEqual(['payable']);
  });

  test('PDF et XLSX : le même grand livre, téléchargé', async ({ page, api }) => {
    await page.goto(`${LEDGER}?periode=annee`);
    await expect(partners(page).first()).toBeVisible();

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
      ['reporting.partner_ledger', 'pdf'],
      ['reporting.partner_ledger', 'xlsx'],
    ]);
  });
});
