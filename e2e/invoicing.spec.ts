import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/** Facturation on the fake API (notes backend 0038, 0040); nothing reaches the real API. */

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(', ')}`,
  );
}

async function newProduct(page: Page, name: string, purchaseAccount: string | null): Promise<void> {
  await page.goto('/app/comptabilite/produits/nouveau');
  await page.getByRole('textbox', { name: 'Nom', exact: true }).fill(name);
  if (purchaseAccount) {
    await page
      .getByRole('combobox', { name: 'Compte d’achat' })
      .selectOption({ label: purchaseAccount });
  }
  await page.getByRole('combobox', { name: 'TVA' }).selectOption({ label: 'TVA 18 %' });
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(`Produit « ${name} » créé.`)).toBeVisible();
}

async function newSupplierInvoice(page: Page, product: string): Promise<void> {
  await page.goto('/app/comptabilite/achats/factures/nouvelle');
  await page.getByRole('combobox', { name: 'Fournisseur' }).fill('Diallo');
  await page.getByRole('option', { name: /Diallo et Cie/ }).click();
  await page.getByRole('textbox', { name: 'Numéro du fournisseur' }).fill('F-77');
  const line = page.locator('[data-line="0"]');
  await line.getByRole('combobox', { name: 'Produit' }).selectOption({ label: product });
  await line.getByRole('textbox', { name: 'Quantité' }).fill('2');
  await line.getByRole('textbox', { name: 'Prix unitaire HT' }).fill('500000');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();
}

async function post(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Comptabiliser' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Comptabiliser' }).click();
}

async function resetToDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Remettre en brouillon' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remettre en brouillon' })
    .click();
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const step = (page: Page) => page.locator('[aria-current=step]');
const total = (page: Page, label: string) => page.locator('.totals div', { hasText: label });

test.describe('Facturation', () => {
  test('un produit, une facture fournisseur comptabilisée : son numéro et son écriture', async ({
    page,
  }) => {
    test.slow(); // the whole life of a document, with three accessibility scans
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Fournisseurs', 'Produits');
    await expect(page).toHaveURL(/\/app\/comptabilite\/produits$/);
    await expect(page.getByText('Cette société n’a pas encore de produit.')).toBeVisible();

    await newProduct(page, 'Fournitures', '601 — Achats de marchandises');
    await expect(page.getByRole('link', { name: 'Fournitures' })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await newSupplierInvoice(page, 'Fournitures');
    // As in Odoo: the kind, « Brouillon » until its number, the server's amounts (2 x 500 000
    // at 18 %) at the bottom right.
    await expect(page.getByText('Facture fournisseur', { exact: true })).toBeVisible();
    await expect(heading(page)).toHaveText('Brouillon');
    await expect(step(page)).toHaveText('Brouillon');
    await expect(total(page, 'Montant hors taxes')).toContainText('1 000 000 GNF');
    await expect(total(page, 'TVA 18 %')).toContainText('180 000 GNF');
    await expect(total(page, 'Total')).toContainText('1 180 000 GNF');
    expect(await axe(page)).toEqual([]);

    await post(page);
    await expect(page.getByText('Facture fournisseur FA-2026-0001 comptabilisée')).toBeVisible();
    await expect(heading(page)).toHaveText('FA-2026-0001');
    await expect(step(page)).toHaveText(/Comptabilisé/);
    await expect(total(page, 'Montant dû')).toContainText('1 180 000 GNF');
    await expect(page.getByRole('button', { name: 'Comptabiliser' })).toHaveCount(0);

    // « Écritures comptables »: the lines of its entry.
    await page.getByRole('tab', { name: 'Écritures comptables' }).click();
    const entry = page.getByRole('table', { name: 'Lignes de l’écriture du document' });
    await expect(entry.getByRole('row', { name: /401 Fournisseurs/ })).toContainText(
      '1 180 000 GNF',
    );
    await expect(entry.getByRole('row', { name: /601 Achats de marchandises/ })).toContainText(
      '1 000 000 GNF',
    );
    await expect(
      page.getByRole('link', { name: 'Ouvrir l’écriture ACH-2026-000001' }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Autres informations' }).click();
    await expect(page.getByRole('link', { name: 'ACH-2026-000001' })).toHaveAttribute(
      'href',
      /\/app\/comptabilite\/ecritures\//,
    );
    expect(await axe(page)).toEqual([]);

    // « Remettre en brouillon »: the entry reversed, the number kept, posted again.
    await resetToDraft(page);
    await expect(
      page.getByText('Facture fournisseur FA-2026-0001 remise en brouillon.'),
    ).toBeVisible();
    await expect(heading(page)).toHaveText('FA-2026-0001');
    await expect(step(page)).toHaveText('Brouillon');
    await expect(page.getByRole('tab', { name: 'Écritures comptables' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Annuler' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);
    await post(page);
    // Same number, a new entry.
    await expect(
      page.getByText('Facture fournisseur FA-2026-0001 comptabilisée : écriture ACH-2026-000002.'),
    ).toBeVisible();
    await expect(heading(page)).toHaveText('FA-2026-0001');

    await openMenuItem(page, 'Fournisseurs', 'Factures');
    await expect(page.getByRole('link', { name: 'FA-2026-0001' })).toBeVisible();
  });

  test('un produit sans compte d’achat : la comptabilisation est refusée', async ({ page }) => {
    await newProduct(page, 'Sans compte', null);
    await newSupplierInvoice(page, 'Sans compte');

    await post(page);

    await expect(
      page.getByText('Un produit de la facture n’a pas de compte pour ce côté.'),
    ).toBeVisible();
    await expect(heading(page)).toHaveText('Brouillon');
  });

  test('un avoir total : la facture est « Extourné » et ne se remet plus en brouillon', async ({
    page,
  }) => {
    await newProduct(page, 'Fournitures', '601 — Achats de marchandises');
    await newSupplierInvoice(page, 'Fournitures');
    await post(page);
    await expect(heading(page)).toHaveText('FA-2026-0001');

    await page.getByRole('button', { name: 'Avoir' }).click();
    await expect(page.getByText('Avoir créé en brouillon')).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    await expect(page.getByText('Avoir fournisseur', { exact: true })).toBeVisible();
    await post(page);
    await expect(heading(page)).toHaveText('AF-2026-0001');
    await page.getByRole('link', { name: 'Ouvrir la facture' }).click();

    await expect(heading(page)).toHaveText('FA-2026-0001');
    await expect(page.locator('.ribbon')).toHaveText('Extourné');
    await expect(total(page, 'Extourné le')).toContainText('AF-2026-0001');
    await expect(total(page, 'Extourné le')).toContainText('1 180 000 GNF');
    await expect(total(page, 'Montant dû')).toContainText('0 GNF');
    expect(await axe(page)).toEqual([]);
    await resetToDraft(page);
    await expect(
      page.getByText('Ce document est réglé ou a un avoir, en tout ou en partie.'),
    ).toBeVisible();
  });
});
