import { expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

/**
 * Comptabilité › Analyse › Bilan (note backend 0056): assets on the left, liabilities on the
 * right, block facing block, the year's result in the equity, both totals; an account toward
 * its ledger; PDF and XLSX; the former address. Fake API only; today is 4 October 2026.
 */

const SHEET = '/app/comptabilite/analyse/bilan';

test.describe('Analyse › Bilan', () => {
  test.beforeEach(async ({ page }) => {
    await fixToday(page);
  });

  test('la fin de l’année par défaut : l’actif en face du passif, le résultat, les totaux', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await page
      .getByRole('navigation', { name: 'Navigation Comptabilité' })
      .getByRole('button', { name: 'Analyse', exact: true })
      .click();
    await page.getByRole('menuitemradio', { name: 'Bilan' }).click();

    await expect(page).toHaveURL(/\/analyse\/bilan$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bilan');
    await expect(page.locator('.report-bench')).toContainText('Au 31/12/2026');
    await expect(page.locator('table.block caption')).toHaveText([
      'Actif immobilisé',
      'Capitaux propres',
      'Dettes financières',
      'Actif circulant',
      'Passif circulant',
      'Trésorerie actif',
      'Trésorerie passif',
    ]);
    await expect(page.locator('table.block').nth(1).locator('tbody tr')).toHaveText([
      /101300\s+Capital souscrit, appelé, versé\s+10\s000\s000/,
      /Résultat de l’exercice\s+2\s500\s000/,
    ]);
    await expect(page.locator('.grand-total')).toHaveText([
      /Total actif\s*16\s500\s000/,
      /Total passif\s*16\s500\s000/,
    ]);
    const asked = new URL(api.callsTo('reporting/balance-sheet/').at(-1)!.url()).searchParams;
    expect([asked.get('date_from'), asked.get('date_to')]).toEqual(['2026-01-01', '2026-12-31']);
  });

  test('un compte mène à son grand livre ; l’ancienne adresse mène au bilan', async ({ page }) => {
    await page.goto('/app/comptabilite/analyse/etats-financiers');
    await expect(page).toHaveURL(/\/analyse\/bilan$/);
    await page.getByRole('link', { name: /521000\s+Banque principale/ }).click();

    await expect(page).toHaveURL(
      /\/analyse\/grand-livre\?compte=521000&periode=perso&du=2026-01-01&au=2026-12-31$/,
    );
  });

  test('PDF et XLSX : le même bilan, téléchargé', async ({ page, api }) => {
    await page.goto(SHEET);
    await expect(page.locator('.grand-total').first()).toBeVisible();

    const pdf = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le bilan en PDF' }).click();
    await pdf;
    const xlsx = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger le bilan en Excel (XLSX)' }).click();
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
      ['reporting.balance_sheet', 'pdf'],
      ['reporting.balance_sheet', 'xlsx'],
    ]);
    expect(bodies[0].parameters).toEqual({ date_from: '2026-01-01', date_to: '2026-12-31' });
  });
});
