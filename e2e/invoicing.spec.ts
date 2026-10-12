import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/**
 * Facturation on the fake API (e2e/support/fake-invoicing.ts, note backend 0038): a product,
 * a supplier invoice saved as a draft then posted (its number and its entry), and a product
 * without account refused at posting. Nothing reaches the real API.
 */

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

test.describe('Facturation', () => {
  test('un produit, une facture fournisseur comptabilisée : son numéro et son écriture', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Fournisseurs', 'Produits');
    await expect(page).toHaveURL(/\/app\/comptabilite\/produits$/);
    await expect(page.getByText('Cette société n’a pas encore de produit.')).toBeVisible();

    await newProduct(page, 'Fournitures', '601 — Achats de marchandises');
    await expect(page.getByRole('link', { name: 'Fournitures' })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await newSupplierInvoice(page, 'Fournitures');
    // The server's amounts: 2 x 500 000 at 18 %.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Facture fournisseur (brouillon)',
    );
    await expect(page.getByText('1 000 000 GNF', { exact: true })).toBeVisible();
    await expect(page.getByText('180 000 GNF', { exact: true })).toBeVisible();
    await expect(page.getByText('1 180 000 GNF', { exact: true }).first()).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await post(page);
    await expect(page.getByText('Facture fournisseur FA-2026-0001 comptabilisée')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Facture fournisseur FA-2026-0001',
    );
    await expect(page.getByRole('link', { name: 'ACH-2026-000001' })).toHaveAttribute(
      'href',
      /\/app\/comptabilite\/ecritures\//,
    );
    await expect(page.getByText('Non payée')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Comptabiliser' })).toHaveCount(0);

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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Facture fournisseur (brouillon)',
    );
  });
});
