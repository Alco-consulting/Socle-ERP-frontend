import { expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

/**
 * Comptabilité › Analyse › Compte de résultat (note backend 0055): charges on the left,
 * products on the right, the profit with the charges, both totals equal; the accounts under
 * their block, each toward its ledger; PDF and XLSX. Fake API only; today is 4 October 2026.
 */

const STATEMENT = '/app/comptabilite/analyse/resultat';

test.describe('Analyse › Compte de résultat', () => {
  test.beforeEach(async ({ page }) => {
    await fixToday(page);
  });

  test('l’année par défaut : les charges en face des produits, le bénéfice, les totaux', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await page
      .getByRole('navigation', { name: 'Navigation Comptabilité' })
      .getByRole('button', { name: 'Analyse', exact: true })
      .click();
    await page.getByRole('menuitemradio', { name: 'Compte de résultat' }).click();

    await expect(page).toHaveURL(/\/analyse\/resultat$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compte de résultat');
    await expect(page.locator('.side-head')).toHaveText([
      /^Charges\s*Montant$/,
      /^Produits\s*Montant$/,
    ]);
    await expect(page.locator('table.block caption')).toHaveText([
      'Charges d’exploitation',
      'Produits d’exploitation',
      'Charges financières',
      'Produits financiers',
      'Charges HAO',
      'Produits HAO',
      'Participation et impôt sur le résultat',
    ]);
    await expect(page.locator('.result.left')).toHaveText(/Bénéfice\s*410\s000/);
    await expect(page.locator('.result.right')).toHaveText(/^\s*Perte\s*$/);
    await expect(page.locator('.grand-total')).toHaveText([
      /Total\s*1\s000\s000/,
      /Total\s*1\s000\s000/,
    ]);
    const asked = new URL(api.callsTo('reporting/income-statement/').at(-1)!.url()).searchParams;
    expect([asked.get('date_from'), asked.get('date_to')]).toEqual(['2026-01-01', '2026-12-31']);
  });

  test('les comptes eux-mêmes sous leur bloc, chacun vers son grand livre', async ({ page }) => {
    await page.goto(STATEMENT);
    await expect(page.locator('table.block').first().locator('tbody tr')).toHaveText([
      /601100\s+Achats de marchandises\s+400\s000/,
      /622000\s+Locations\s+100\s000/,
    ]);
    await page.getByRole('link', { name: /601100\s+Achats de marchandises/ }).click();

    await expect(page).toHaveURL(
      /\/analyse\/grand-livre\?compte=601100&periode=perso&du=2026-01-01&au=2026-12-31$/,
    );
  });

  test('PDF et XLSX : le même compte de résultat, téléchargé', async ({ page, api }) => {
    await page.goto(STATEMENT);
    await expect(page.locator('.grand-total').first()).toBeVisible();

    const pdf = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le compte de résultat en PDF' }).click();
    await pdf;
    const xlsx = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Télécharger le compte de résultat en Excel (XLSX)' })
      .click();
    await xlsx;
    const bodies = api.callsTo('imports-exports/exports/').map(
      (call) =>
        call.postDataJSON() as {
          export_type: string;
          file_format: string;
          parameters: Record<string, string>;
        },
    );
    expect(bodies.map((body) => [body.export_type, body.file_format])).toEqual([
      ['reporting.income_statement', 'pdf'],
      ['reporting.income_statement', 'xlsx'],
    ]);
    expect(bodies[0].parameters).toEqual({ date_from: '2026-01-01', date_to: '2026-12-31' });
  });
});
