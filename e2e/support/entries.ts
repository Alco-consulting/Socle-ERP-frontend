import { Page, expect } from '@playwright/test';

/** Steps of the entry form shared by the e2e specs (real screens, fake API). */

export type Side = 'Débit' | 'Crédit';

/** « Date » of the entry (not « Date de la pièce »). */
export const dateField = (page: Page) => page.getByRole('textbox', { name: 'Date', exact: true });

/** Picks an account in a line: typed, searched by the server, chosen in its answers. */
export async function chooseAccount(page: Page, line: number, code: string): Promise<void> {
  const field = page.locator(`[data-line="${line}"]`).getByRole('combobox', { name: 'Compte' });
  await field.fill(code);
  await page
    .getByRole('option', { name: new RegExp(`^${code}\\b`) })
    .first()
    .click();
  await expect(field).toHaveValue(code);
}

export async function fillLine(
  page: Page,
  line: number,
  code: string,
  side: Side,
  amount: string,
): Promise<void> {
  await chooseAccount(page, line, code);
  await page.locator(`[data-line="${line}"]`).getByRole('textbox', { name: side }).fill(amount);
}

export interface NewEntry {
  readonly journal?: string;
  readonly date: string;
  readonly description: string;
  readonly lines: readonly (readonly [code: string, side: Side, amount: string])[];
}

/** Fills the header and the lines of « Nouvelle écriture » (without saving). */
export async function fillEntry(page: Page, entry: NewEntry): Promise<void> {
  // Entered by hand in miscellaneous operations only (note backend 0038).
  await page
    .getByLabel('Journal')
    .selectOption({ label: entry.journal ?? 'OD — Opérations diverses' });
  await dateField(page).fill(entry.date);
  await page.getByRole('textbox', { name: 'Libellé', exact: true }).fill(entry.description);
  for (const [index, [code, side, amount]] of entry.lines.entries()) {
    if (index >= 2) {
      await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
    }
    await fillLine(page, index, code, side, amount);
  }
}

/** Creates a draft from the list's « Nouvelle écriture » and lands on its record. */
export async function createEntry(page: Page, entry: NewEntry): Promise<void> {
  await page.goto('/app/comptabilite/ecritures/nouvelle');
  await fillEntry(page, entry);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Écriture créée.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Écriture sans numéro');
}

/** Confirms the alert dialog of a command with its named button. */
export async function confirmWith(page: Page, button: string): Promise<void> {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await dialog.getByRole('button', { name: button, exact: true }).click();
}
