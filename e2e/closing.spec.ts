import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/**
 * Comptabilité › Clôture on the fake API (e2e/support/fake-closing.ts): a fiscal year closes
 * with all its periods; it reopens alone, then one period at a time (note backend 0036).
 * Nothing reaches the real API.
 */

const BEFORE_VALIDATION = 6;

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(', ')}`,
  );
}

const stepAction = (page: Page) => page.locator('.step-action');

async function runStep(page: Page, label: string, toast: string): Promise<void> {
  await stepAction(page).filter({ hasText: label }).click();
  await expect(page.getByText(toast)).toBeVisible();
}

async function reason(page: Page, button: string, text: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motif').fill(text);
  await dialog.getByRole('button', { name: button }).click();
}

test.describe('Clôture', () => {
  test('un exercice se clôture avec toutes ses périodes, se rouvre seul, puis une période', async ({
    page,
    api,
  }) => {
    api.closing.blockingOnce = 'pre_close_checks';
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Comptabilité', 'Clôture');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clôture');
    await expect(page.getByText('Aucune clôture pour l’instant.')).toBeVisible();

    await page.getByRole('button', { name: 'Démarrer la clôture de Exercice 2026' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clôture — Exercice 2026');
    await expect(page.locator('.step')).toHaveCount(10);

    // A blocking point: said by its code, in words; the step is retried.
    await runStep(page, 'Exécuter', 'Contrôles avant clôture : des points bloquent l’étape.');
    await expect(page.locator('.step').first()).toContainText('Écritures non validées');
    await expect(page.locator('.step').first()).toContainText('Bloquant');
    await runStep(page, 'Réessayer', 'Contrôles avant clôture : étape réussie.');
    for (let index = 1; index < BEFORE_VALIDATION; index += 1) {
      await stepAction(page).click();
      await expect(page.locator('.step').nth(index)).toContainText('Réussie');
    }
    await runStep(page, 'Valider la clôture', 'Validation : étape réussie.');
    await runStep(page, 'Exécuter', 'Résultat de l’exercice : étape réussie.');

    await stepAction(page).filter({ hasText: 'Clôturer l’exercice' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Clôturer l’exercice 2026 ?');
    await expect(confirm).toContainText('L’exercice et toutes ses périodes seront clôturés');
    expect(await axe(page)).toEqual([]);
    await confirm.getByRole('button', { name: 'Clôturer l’exercice' }).click();
    await expect(page.getByText('Clôture : étape réussie.')).toBeVisible();
    const periods = page.locator('alco-card', { hasText: 'Périodes de l’exercice' });
    await expect(periods.locator('tbody tr')).toHaveCount(6);
    await expect(periods.locator('tbody tr', { hasText: 'Ouverte' })).toHaveCount(0);
    await runStep(page, 'Exécuter', 'Ouverture de l’exercice suivant : étape réussie.');
    await expect(page.locator('alco-page-header')).toContainText('Terminée');

    // The year reopens alone: its periods stay closed.
    await page.getByRole('button', { name: 'Rouvrir l’exercice' }).click();
    await expect(page.getByRole('dialog')).toContainText('ses périodes resteront clôturées');
    await reason(page, 'Rouvrir l’exercice', 'Écriture d’audit');
    await expect(
      page.getByText('Exercice 2026 rouvert : ses périodes restent clôturées.'),
    ).toBeVisible();
    await expect(periods).toContainText('Rouvrez celles qui doivent recevoir des écritures');
    await expect(periods.locator('tbody tr', { hasText: 'Ouverte' })).toHaveCount(0);

    // Then March, explicitly, with its reason.
    await page.getByRole('button', { name: 'Rouvrir Mars 2026' }).click();
    await reason(page, 'Rouvrir la période', 'Facture tardive de mars');
    await expect(page.getByText('Période Mars 2026 rouverte.')).toBeVisible();
    await expect(periods.locator('tbody tr', { hasText: 'Mars 2026' })).toContainText('Ouverte');
    await expect(periods.locator('tbody tr', { hasText: 'Ouverte' })).toHaveCount(1);
    const history = page.locator('alco-card', { hasText: 'Réouvertures' });
    await expect(history).toContainText('Exercice rouvert');
    await expect(history).toContainText('Période Mars 2026 rouverte');
    await expect(history).toContainText('Motif : Facture tardive de mars');
    const books = api.accounting.books('A');
    expect(books.years.find((year) => year.code === '2026')?.status).toBe('open');
    expect(books.periods.filter((item) => item.status === 'open').map((item) => item.code)).toEqual(
      ['2026-03'],
    );
    expect(await axe(page)).toEqual([]);
  });

  test('lecture seule : aucune commande', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, ['accounting.read', 'closing.read']);
    await page.goto('/app/comptabilite/cloture');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clôture');
    await expect(page.getByRole('button', { name: /Démarrer la clôture/ })).toHaveCount(0);
  });
});
