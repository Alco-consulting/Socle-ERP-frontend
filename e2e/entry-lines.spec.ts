import { Page } from '@playwright/test';

import { COMPANY_A, expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/** « Écritures comptables » (note backend 0039) on the fake API. */

const rows = (page: Page) => page.locator('tbody tr');
const classes = (page: Page) =>
  page.getByRole('navigation', { name: 'Classes de comptes des écritures' });

test.describe('Écritures comptables : une ligne par ligne d’écriture, comme Odoo', () => {
  test('the posted lines, their columns, the classes and the link to the piece', async ({
    page,
    api,
  }) => {
    const posted = api.entries
      .entries('A')
      .filter((entry) => entry.status === 'validated' || entry.status === 'locked');
    const lines = posted.flatMap((entry) => entry.lines);
    const expenses = lines.filter((line) => line.account.code.startsWith('6'));
    expect(expenses.length).toBeGreaterThan(0);

    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Comptabilité', 'Écritures');
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écritures comptables');
    await expect(page.getByRole('columnheader')).toHaveText([
      'Date',
      'Pièce comptable',
      'Compte',
      'Partenaire',
      'Libellé',
      'Débit',
      'Crédit',
      'Lettrage',
    ]);
    await expect(rows(page)).toHaveCount(Math.min(lines.length, 50));
    await expect(classes(page).getByRole('button', { name: /^Tous/ })).toContainText(
      String(lines.length),
    );
    // No creation here: the entries come from their documents.
    await expect(page.getByRole('link', { name: 'Nouvelle écriture' })).toHaveCount(0);

    // Class 6: the expense lines only.
    await classes(page).getByRole('button', { name: /^6\s/ }).click();
    await expect(page).toHaveURL(/classe=6/);
    await expect(rows(page)).toHaveCount(Math.min(expenses.length, 50));
    for (const row of await rows(page).all()) {
      await expect(row.locator('td').nth(2)).toHaveText(/^\s*6/);
    }
    const last = api.callsTo('accounting/entry-lines/').at(-1);
    expect(new URL(last!.url()).searchParams.get('account_prefix')).toBe('6');
    expect(await last?.headerValue('x-company-id')).toBe(COMPANY_A.public_id);

    // The piece opens the entry; the breadcrumb comes back to the lines.
    const piece = rows(page).first().getByRole('link');
    const number = (await piece.textContent())!.trim();
    await piece.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(number);
    await page.goBack();
    await expect(page).toHaveURL(/classe=6/);
  });

  test('the drafts by the filters, then the pieces themselves', async ({ page, api }) => {
    const drafts = api.entries.entries('A').filter((entry) => entry.status === 'draft');
    const draftLines = drafts.flatMap((entry) => entry.lines);
    expect(draftLines.length).toBeGreaterThan(0);

    await page.goto('/app/comptabilite/ecritures');
    await expect(rows(page).first()).toBeVisible();
    await page.getByRole('button', { name: 'Filtres' }).click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('État').selectOption({ label: 'Brouillons' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/etat=draft/);
    await expect(rows(page)).toHaveCount(Math.min(draftLines.length, 50));
    for (const row of await rows(page).all()) {
      await expect(row.getByRole('link')).toHaveText('Brouillon');
    }

    await page.getByRole('link', { name: 'Pièces comptables' }).click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/ecritures\/pieces$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pièces comptables');
  });

  test('the search keeps the matching lines; nothing found offers to reset', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures');
    await expect(rows(page).first()).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'Rechercher une écriture' });
    await search.fill('introuvable-xyz');
    await expect(page).toHaveURL(/q=introuvable-xyz/);
    await expect(page.getByText('Aucune écriture ne correspond à ces critères.')).toBeVisible();
    await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(rows(page).first()).toBeVisible();
  });
});
