import { expect, test } from '@playwright/test';

test.describe('Vue formulaire : sections, validation, workflow piloté par le serveur', () => {
  test('saving an incomplete entry points to what is missing', async ({ page }) => {
    await page.goto('/comptabilite/ecritures/nouvelle');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(
      page.getByText('Certaines informations sont manquantes ou incorrectes.'),
    ).toBeVisible();
    const label = page.getByRole('textbox', { name: 'Libellé', exact: true });
    await expect(label).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Ce champ est obligatoire.').first()).toBeVisible();
  });

  test('creates a balanced draft, then validates it', async ({ page }) => {
    await page.goto('/comptabilite/ecritures/nouvelle?journal=ACH');
    await expect(page.getByLabel('Journal')).toHaveValue('ACH');
    await page.getByRole('textbox', { name: 'Libellé', exact: true }).fill('Achat de test (démo)');
    await page.getByLabel('Compte, ligne 1').selectOption('601100');
    await page.getByLabel('Débit, ligne 1').fill('250 000');
    await page.getByLabel('Compte, ligne 2').selectOption('401100');
    await page.getByLabel('Crédit, ligne 2').fill('250000');
    await expect(page.getByText('Débit et crédit sont égaux.')).toBeVisible();

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/Brouillon EC-2026-\d{6} enregistré\./)).toBeVisible();
    await expect(page).toHaveURL(/\/comptabilite\/ecritures\/proto-new-\d+$/);

    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Valider cette écriture ?' });
    await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Valider l’écriture' }).click();

    await expect(page.getByText(/Écriture EC-2026-\d{6} validée\./)).toBeVisible();
    await expect(page.locator('alco-page-header').getByText('Validée')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Contrepasser' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0);
    await expect(page.getByLabel('Débit, ligne 1')).toBeDisabled();
  });

  test('a server refusal is explained in plain words, the code stays in the details', async ({
    page,
  }) => {
    await page.goto('/comptabilite/ecritures/proto-050');
    await expect(page.getByText(/Écart de 30\s000 GNF/)).toBeVisible();
    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    await page.getByRole('button', { name: 'Valider l’écriture' }).click();

    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Impossible de valider cette écriture.' });
    await expect(alert).toContainText('Le total Débit ne correspond pas au total Crédit.');
    await expect(alert.getByText('accounting_entry_unbalanced')).toBeHidden();
    await alert.getByRole('button', { name: 'Comprendre l’erreur' }).click();
    await expect(alert).toContainText('la somme des débits est égale à la somme des crédits');
    await alert.getByText('Détails techniques (support)').click();
    await expect(alert.getByText('accounting_entry_unbalanced')).toBeVisible();
  });

  test('tabs hold the secondary information', async ({ page }) => {
    await page.goto('/comptabilite/ecritures/proto-045');
    await page.getByRole('tab', { name: /Pièces justificatives/ }).click();
    await expect(page.getByText('Aucune pièce justificative.')).toBeVisible();
    await page.getByRole('tab', { name: /Informations avancées/ }).click();
    await expect(page.getByLabel(/Note interne/)).toBeVisible();
  });
});
