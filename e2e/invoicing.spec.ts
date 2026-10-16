import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { expect, test } from './support/fake-api';
import { openMenuItem } from './support/navigation';

/** Facturation on the fake API (notes backend 0038, 0040, 0041); nothing reaches the real API. */

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
    // Any account of the chart, searched by its code (note backend 0045).
    const [code] = purchaseAccount.split(' ');
    await page.getByRole('combobox', { name: 'Compte d’achat' }).fill(code);
    await page.getByRole('option', { name: new RegExp(`^${code}\\b`) }).click();
  }
  await page.getByRole('combobox', { name: 'TVA' }).selectOption({ label: 'TVA 18 %' });
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(`Produit « ${name} » créé.`)).toBeVisible();
}

async function newSupplierInvoice(page: Page, product: string): Promise<void> {
  await page.goto('/app/comptabilite/achats/factures/nouvelle');
  await page.getByRole('combobox', { name: 'Fournisseur' }).fill('Diallo');
  await page.getByRole('option', { name: /Diallo et Cie/ }).click();
  await page.getByRole('textbox', { name: 'Référence de la facture' }).fill('F-77');
  await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
  const line = page.locator('[data-line="0"]');
  await line.getByRole('combobox', { name: 'Produit' }).selectOption({ label: product });
  await line.getByRole('textbox', { name: 'Quantité' }).fill('2');
  await line.getByRole('textbox', { name: 'Prix' }).fill('500000');
  // ☁ as in Odoo: the draft saved, its record opened in its place.
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();
  await expect(page).toHaveURL(/\/achats\/factures\/[\w-]+$/);
}

async function post(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmer' }).click();
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
    await expect(page.getByRole('button', { name: 'Confirmer' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Quantité' })).toHaveCount(0);

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
    // Editable again, in place.
    await page.getByRole('tab', { name: 'Lignes de facture' }).click();
    await expect(page.getByRole('textbox', { name: 'Quantité' })).toBeVisible();
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

  test('les unités : 1 sac de 50 kg = 50 kg, acheté au sac, le prix converti au kg', async ({
    page,
  }) => {
    test.slow(); // the list, a product, an invoice, an accessibility scan
    // Configuration › Unités de mesure: « 1 t = 1 000 kg »; « 1 Sac de 50 kg = 50 kg » added
    // (note backend 0047).
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Configuration', 'Unités de mesure');
    await expect(heading(page)).toHaveText('Unités de mesure');
    await expect(page.getByRole('row', { name: /^t / })).toContainText(/1 t = 1\s000 kg/);
    await page.getByRole('button', { name: 'Nouvelle unité' }).click();
    await page.getByRole('textbox', { name: 'Nom de l’unité' }).fill('Sac de 50 kg');
    await page.getByRole('textbox', { name: 'Quantité' }).fill('50');
    await page.getByRole('combobox', { name: 'Unité de l’équivalence' }).selectOption({
      label: 'kg',
    });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('row', { name: /Sac de 50 kg/ })).toContainText(
      '1 Sac de 50 kg = 50 kg',
    );
    expect(await axe(page)).toEqual([]);

    // The product: sold by the kg, bought by the bag.
    await page.goto('/app/comptabilite/produits/nouveau');
    await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Riz');
    await page.getByRole('combobox', { name: 'Compte d’achat' }).fill('601');
    await page.getByRole('option', { name: /^601\b/ }).click();
    await page.getByRole('combobox', { name: 'TVA' }).selectOption({ label: 'TVA 18 %' });
    await page.getByRole('combobox', { name: 'Unité de vente' }).selectOption({ label: 'kg' });
    await page.getByRole('combobox', { name: 'Unité d’achat' }).selectOption({
      label: 'Sac de 50 kg',
    });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Produit « Riz » créé.')).toBeVisible();

    // A supplier invoice: the line in bags; by the kg, its price follows.
    await page.goto('/app/comptabilite/achats/factures/nouvelle');
    await page.getByRole('combobox', { name: 'Fournisseur' }).fill('Diallo');
    await page.getByRole('option', { name: /Diallo et Cie/ }).click();
    await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
    const line = page.locator('[data-line="0"]');
    await line.getByRole('combobox', { name: 'Produit' }).selectOption({ label: 'Riz' });
    const unit = line.getByRole('combobox', { name: 'Unité' });
    await expect(unit.locator('option:checked')).toHaveText('Sac de 50 kg');
    await line.getByRole('textbox', { name: 'Prix' }).fill('500000');
    await unit.selectOption({ label: 'kg' });
    await expect(line.getByRole('textbox', { name: 'Prix' })).toHaveValue('10000');
    await line.getByRole('textbox', { name: 'Quantité' }).fill('100');
    await expect(total(page, 'Montant hors taxes')).toContainText('1 000 000 GNF');
  });

  test('sections, notes, units and the catalogue, as in Odoo; the amounts as typed', async ({
    page,
  }) => {
    test.slow(); // a document built line by line, with an accessibility scan
    await newProduct(page, 'Licence', '601 — Achats de marchandises');
    await page.goto('/app/comptabilite/achats/factures/nouvelle');
    await expect(heading(page)).toHaveText('Brouillon');
    await expect(page.getByRole('tab')).toHaveText([
      'Lignes de facture',
      'Écritures comptables',
      'Autres informations',
    ]);
    await page.getByRole('combobox', { name: 'Fournisseur' }).fill('Diallo');
    await page.getByRole('option', { name: /Diallo et Cie/ }).click();

    await page.getByRole('button', { name: 'Ajouter une section' }).click();
    await page.getByRole('textbox', { name: 'Section' }).fill('Logiciels');
    await page.getByRole('button', { name: 'Ajouter une note' }).click();
    await page.getByRole('textbox', { name: 'Note' }).fill('Livré à Conakry');

    // The catalogue fills the empty product line.
    await page.getByRole('button', { name: 'Catalogue' }).click();
    const catalog = page.getByRole('dialog', { name: 'Catalogue' });
    await catalog.getByRole('button', { name: 'Ajouter Licence' }).click();
    await catalog.getByRole('button', { name: 'Ajouter un Licence' }).click();
    await expect(catalog.getByRole('group', { name: 'Quantité de Licence' })).toContainText('2');
    expect(await axe(page)).toEqual([]);
    await catalog.getByRole('button', { name: 'Retour au document' }).click();
    const line = page.locator('tr', { has: page.getByRole('combobox', { name: 'Produit' }) });
    await expect(line).toHaveCount(1);
    await expect(line.getByRole('textbox', { name: 'Quantité' })).toHaveValue('2');
    await line.getByRole('textbox', { name: 'Prix' }).fill('750000');

    // The server computes as typed: « Montant », the totals, the entry to come.
    await expect(line).toContainText('1 500 000 GNF');
    await expect(total(page, 'Total')).toContainText('1 770 000 GNF');
    await page.getByRole('tab', { name: 'Écritures comptables' }).click();
    await expect(
      page.getByRole('table', { name: 'Lignes de l’écriture à venir' }).getByRole('row'),
    ).toHaveCount(3);
    await page.getByRole('tab', { name: 'Lignes de facture' }).click();

    await post(page);
    await expect(page.getByText('Facture fournisseur FA-2026-0001 comptabilisée')).toBeVisible();
    await expect(heading(page)).toHaveText('FA-2026-0001');
    await expect(page.locator('tr.section')).toHaveText('Logiciels');
    await expect(page.locator('tr.text-note')).toHaveText('Livré à Conakry');
    expect(await axe(page)).toEqual([]);
  });
});
