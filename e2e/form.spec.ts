import { dateField, fillEntry } from './support/entries';
import { expect, test } from './support/fake-api';

/** The form view of the design system, on the real entry form (fake server). */
test.describe('Vue formulaire : sections, validation, refus du serveur sous le champ', () => {
  test('saving an incomplete entry points to what is missing', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/nouvelle');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(
      page.getByText('Certaines informations sont manquantes ou incorrectes.'),
    ).toBeVisible();
    await expect(page.getByLabel('Journal')).toBeFocused();
    const label = page.getByRole('textbox', { name: 'Libellé', exact: true });
    await expect(label).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Ce champ est obligatoire.').first()).toBeVisible();
  });

  test('a text typed in an account field but not chosen is said', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/nouvelle');
    const account = page.locator('[data-line="0"]').getByRole('combobox', { name: 'Compte' });
    await account.fill('60');
    await expect(page.getByRole('option', { name: /^601/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(account).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Choisissez une proposition de la liste.')).toBeVisible();
  });

  test('a refusal of the server goes under its field; the code stays in the details', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/ecritures/nouvelle');
    await fillEntry(page, {
      date: '2026-02-10', // a closed period of the fake company A
      description: 'Achat de février',
      lines: [
        ['601', 'Débit', '1000'],
        ['401', 'Crédit', '1000'],
      ],
    });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    const date = page.locator('alco-form-field', { has: dateField(page) });
    await expect(date).toContainText('La période de cette date est clôturée.');
    await expect(dateField(page)).toBeFocused();
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'La période de cette date est clôturée.' });
    await alert.getByText('Détails techniques (support)').click();
    await expect(alert.getByText('accounting_period_closed')).toBeVisible();
  });

  test('the advanced section opens on demand', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/nouvelle');
    await expect(page.getByLabel('Arrondi')).toBeHidden();
    await page.getByText('Informations avancées').click();
    await expect(page.getByLabel('Arrondi')).toBeVisible();
  });
});
