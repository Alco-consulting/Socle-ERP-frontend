import { expect, test } from './support/fake-api';

/** The list view of the design system, on real screens of the API (fake server). */
test.describe('Vue liste : filtres, regroupement, recherche, état dans l’URL', () => {
  test('the filter panel: counted criteria, reset, Escape returns the focus', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page.getByRole('table')).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Filtres' });
    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('État').selectOption({ label: 'Brouillon' });
    await panel.getByLabel('Du').fill('2026-03-01');
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/etat=draft/);
    await expect(page).toHaveURL(/du=2026-03-01/);
    await expect(page.getByRole('button', { name: 'Filtres (2)' })).toBeFocused();
    await expect(page.locator('tbody').getByText('Validée')).toHaveCount(0);

    await page.getByRole('button', { name: 'Filtres (2)' }).click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Filtres (2)' })).toBeFocused();

    await page.getByRole('button', { name: 'Filtres (2)' }).click();
    await panel.getByRole('button', { name: 'Réinitialiser' }).click();
    await expect(page).not.toHaveURL(/etat=|du=/);
  });

  test('groups by code group with group headers and counts (chart of accounts)', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/plan-comptable');
    await page.getByRole('button', { name: 'Regrouper' }).click();
    await page.getByRole('menuitemradio', { name: 'Groupe', exact: true }).click();
    await expect(page).toHaveURL(/groupe=groupe/);
    await expect(page.getByRole('button', { name: /^Groupe 40 \(\d+\)$/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retirer le critère Regroupé par : Groupe' }),
    ).toBeVisible();
  });

  test('a search without result explains and offers to reset (Tiers)', async ({ page }) => {
    await page.goto('/app/contacts/liste');
    await page.getByRole('searchbox', { name: 'Rechercher un contact' }).fill('introuvable-xyz');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Aucun contact ne correspond à ces critères.')).toBeVisible();
    await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('pages come from the server; back keeps the page', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(page.getByText(/1–20\s*sur\s*48/)).toBeVisible();
    await page.getByRole('button', { name: 'Page suivante' }).click();
    await expect(page.getByText(/21–40\s*sur\s*48/)).toBeVisible();
    await page.locator('tbody a').first().click();
    await expect(page).toHaveURL(/\/ecritures\/[\w-]+$/);
    await page.goBack();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/21–40\s*sur\s*48/)).toBeVisible();
  });

  test('taille de page : 20 par défaut, 40, 50 ou 100 au choix, gardée et reprise ailleurs', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/ecritures/pieces?page=2');
    const size = page.getByRole('combobox', { name: 'Lignes par page' });
    await expect(size).toHaveValue('20');
    await expect(page.getByText('Page 2 sur 3')).toBeVisible();

    // Une autre taille : dans l'adresse, demandée au serveur, et la liste repart de la page 1.
    await size.selectOption('50');
    await expect(page).toHaveURL(/par_page=50/);
    await expect(page).not.toHaveURL(/page=2/);
    await expect(page.getByText(/1–48\s*sur\s*48/)).toBeVisible();
    const last = api.callsTo('accounting/entries/').at(-1)!;
    expect(new URL(last.url()).searchParams.get('page_size')).toBe('50');
    // Une seule page : pas de navigation inutile.
    await expect(page.getByRole('button', { name: 'Page suivante' })).toHaveCount(0);

    // Gardée au rechargement, et reprise par une autre liste sur cet appareil.
    await page.reload();
    await expect(size).toHaveValue('50');
    await page.goto('/app/contacts/liste');
    await expect(page.getByRole('combobox', { name: 'Lignes par page' })).toHaveValue('50');
    const contacts = api.callsTo('partners/').at(-1)!;
    expect(new URL(contacts.url()).searchParams.get('page_size')).toBe('50');
  });

  test('pagination : première et dernière page', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await page.getByRole('button', { name: 'Dernière page' }).click();
    await expect(page).toHaveURL(/page=3/);
    await expect(page.getByText(/41–48\s*sur\s*48/)).toBeVisible();
    await page.getByRole('button', { name: 'Première page' }).click();
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByText(/1–20\s*sur\s*48/)).toBeVisible();
  });
});
