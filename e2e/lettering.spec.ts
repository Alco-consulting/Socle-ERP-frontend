import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';
import { fixToday, openMenuItem } from './support/navigation';

/**
 * Comptabilité › Lettrage (V2.1, lot A4) against the fake API: open lines, filters,
 * selection, preview, manual and partial lettering, proposals, unlettering, history,
 * permissions, company change, a line lettered in between, the smart buttons of the records,
 * accessibility. The fake answers from explicit fixtures (e2e/support/fake-lettering.ts):
 * no matching is played anywhere in the front end nor in the fake.
 */

const URL_ = '/app/comptabilite/lettrage';
const lines = (page: Page) => page.locator('.wide tbody tr');
const pick = (page: Page, number: string) =>
  page.locator('.wide').getByRole('checkbox', { name: new RegExp(`^Sélectionner ${number} `) });
const status = (page: Page) => page.locator('.selection-bar [role=status]');
const preview = (page: Page) => page.getByRole('region', { name: 'Aperçu du lettrage' });

test.beforeEach(async ({ page }) => fixToday(page));

test.describe('Lettrage — lignes ouvertes', () => {
  test('1. ouvrir Lettrage depuis le menu : les lignes ouvertes du serveur', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Comptabilité', 'Lettrage');
    await expect(page).toHaveURL(/\/app\/comptabilite\/lettrage$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lettrage');
    await expect(page.getByRole('tab', { name: 'Lignes à lettrer' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // L1…L6 are open; the supplier lines are already lettered (LET-000001).
    await expect(lines(page)).toHaveCount(6);
    await expect(page.getByText('6 lignes')).toBeVisible();
  });

  test('2. filtrer par compte : le code dans l’URL, l’identifiant au serveur', async ({
    page,
    api,
  }) => {
    await page.goto(URL_);
    await page.getByRole('button', { name: 'Filtres' }).click();
    const filters = page.getByRole('dialog', { name: 'Filtres' });
    await filters.getByRole('textbox', { name: 'Compte' }).fill('401');
    await filters.getByRole('combobox', { name: 'État des lignes' }).selectOption('lettered');
    await filters.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/compte=401/);
    await expect(page).toHaveURL(/etat=lettered/);
    await expect(lines(page)).toHaveCount(2);
    await expect(lines(page).first()).toContainText('Lettrée');
    const call = api.callsTo('accounting/letterable-lines/').at(-1)!;
    const account = api.accounting.books('A').accounts.find((item) => item.code === '401')!;
    expect(new URL(call.url()).searchParams.get('account')).toBe(account.public_id);
    // Reload: the context is kept by the URL.
    await page.reload();
    await expect(lines(page)).toHaveCount(2);
  });

  test('3. filtrer par tiers', async ({ page }) => {
    await page.goto(`${URL_}?tiers=CLI-002`);
    await expect(lines(page)).toHaveCount(2);
    await expect(page.getByText('Tiers CLI-002')).toBeVisible();
    await expect(lines(page).first()).toContainText('VTE-000103');
  });
});

test.describe('Lettrage manuel', () => {
  test('4-7. sélectionner, apercevoir, confirmer : l’état du serveur', async ({ page, api }) => {
    await page.goto(URL_);
    await pick(page, 'VTE-000101').check();
    await pick(page, 'BQ1-000201').check();
    await expect(status(page)).toHaveText(
      '2 lignes sélectionnées. Ouvert au débit 1 200 000 GNF, au crédit 1 200 000 GNF, écart 0 GNF.',
    );
    await page.getByRole('button', { name: 'Aperçu du lettrage' }).click();
    await expect(preview(page)).toContainText('Lettrage complet');
    await expect(preview(page).getByRole('heading')).toBeFocused();
    expect(api.lettering.letterings('A')).toHaveLength(1); // nothing written by the preview

    await preview(page).getByRole('button', { name: 'Confirmer le lettrage' }).click();
    await expect(page.getByText('Lettrage LET-000002 créé.')).toBeVisible();
    expect(api.lettering.line('A', 'L1').status).toBe('lettered');
    expect(api.lettering.line('A', 'L2').status).toBe('lettered');
    await expect(lines(page)).toHaveCount(4);
    await expect(preview(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('Aucune ligne sélectionnée.');
    const create = api.callsTo('accounting/letterings/').find((call) => call.method() === 'POST')!;
    const body = create.postDataJSON() as Record<string, unknown>;
    expect(body['idempotency_key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(body['write_off']).toBeUndefined();
  });

  test('8-9. lettrage partiel : écart refusé, puis partiel demandé, résiduel ouvert', async ({
    page,
    api,
  }) => {
    await page.goto(URL_);
    await pick(page, 'VTE-000102').check();
    await pick(page, 'BQ1-000202').check();
    await expect(status(page)).toContainText('écart 200 000 GNF');
    await page.getByRole('button', { name: 'Aperçu du lettrage' }).click();
    await expect(preview(page)).toContainText(
      'Le débit et le crédit sélectionnés ne sont pas égaux.',
    );
    await expect(preview(page)).toContainText('200 000 GNF');
    await preview(page).getByRole('button', { name: 'Prévisualiser un lettrage partiel' }).click();
    await expect(preview(page)).toContainText('Lettrage partiel : un résiduel restera ouvert');
    await expect(preview(page).locator('.residual')).toHaveText('200 000');
    await preview(page).getByRole('button', { name: 'Confirmer le lettrage' }).click();
    await expect(
      page.getByText('Lettrage LET-000002 créé. Le résiduel reste ouvert.'),
    ).toBeVisible();
    expect(api.lettering.line('A', 'L3')).toMatchObject({
      status: 'partial',
      open_amount: '200000.000000',
    });
    const invoice = lines(page).filter({ hasText: 'VTE-000102' });
    await expect(invoice).toContainText('Partiellement lettrée');
    await expect(invoice).toContainText('200 000');
    await expect(lines(page).filter({ hasText: 'BQ1-000202' })).toHaveCount(0);
  });

  test('16. une ligne lettrée entre-temps : erreur du serveur, liste relue, sélection vidée', async ({
    page,
    api,
  }) => {
    await page.goto(URL_);
    await pick(page, 'VTE-000101').check();
    await pick(page, 'BQ1-000201').check();
    await page.getByRole('button', { name: 'Aperçu du lettrage' }).click();
    await expect(preview(page)).toContainText('Lettrage complet');
    api.lettering.letterBehind('A', ['L1', 'L2']); // another user, meanwhile
    await preview(page).getByRole('button', { name: 'Confirmer le lettrage' }).click();
    await expect(page.getByText('Une ligne sélectionnée est déjà lettrée.')).toBeVisible();
    await expect(lines(page)).toHaveCount(4);
    await expect(status(page)).toHaveText('Aucune ligne sélectionnée.');
    expect(api.lettering.letterings('A')).toHaveLength(2); // nothing lettered twice
  });
});

test.describe('Propositions', () => {
  test('10-11. ouvrir les propositions, en confirmer une', async ({ page, api }) => {
    await page.goto(URL_);
    await page.getByRole('tab', { name: 'Propositions' }).click();
    await expect(page).toHaveURL(/vue=propositions/);
    const card = page.locator('.proposal');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('411 · CLI-002');
    await expect(card).toContainText('750 000 GNF');
    await expect(card).toContainText('Proposée, non lettrée');
    await card
      .getByRole('button', { name: 'Confirmer la proposition VTE-000103 / BQ1-000203' })
      .click();
    await expect(page.getByText('Lettrage LET-000002 créé.')).toBeVisible();
    await expect(page.getByText('Aucune proposition de lettrage.')).toBeVisible();
    expect(api.lettering.letterings('A').at(-1)).toMatchObject({ kind: 'automatic' });
  });
});

test.describe('Délettrage et historique', () => {
  test('12-13. délettrer un lettrage confirmé : motif, état du serveur, historique', async ({
    page,
    api,
  }) => {
    await page.goto(`${URL_}?vue=lettrages`);
    const row = page.locator('tbody tr').filter({ hasText: 'LET-000001' });
    await expect(row).toContainText('Actif');
    await row.getByRole('link', { name: 'LET-000001' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lettrage LET-000001');
    await expect(page.locator('#lignes tbody tr')).toHaveCount(2);
    await expect(page.locator('#historique')).toContainText('Lettrage');

    await page.getByRole('button', { name: 'Délettrer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Délettrer LET-000001 ?' });
    await dialog.getByRole('button', { name: 'Délettrer' }).click();
    await expect(dialog.getByText('Indiquez le motif du délettrage.')).toBeVisible();
    await dialog.getByLabel('Motif').fill('Paiement affecté à une autre facture');
    await dialog.getByRole('button', { name: 'Délettrer' }).click();
    await expect(
      page.getByText('Lettrage annulé. Les lignes sont de nouveau ouvertes.'),
    ).toBeVisible();
    await expect(page.getByText('Ce lettrage est annulé')).toBeVisible();
    await expect(page.getByText('Paiement affecté à une autre facture')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Délettrer' })).toHaveCount(0);
    await expect(page.locator('#historique')).toContainText('Délettrage');
    expect(api.lettering.line('A', 'L7').status).toBe('open');

    // The cancelled lettering stays in the list, with its state.
    await page.goto(`${URL_}?vue=lettrages&etat=cancelled`);
    await expect(page.locator('tbody tr').filter({ hasText: 'LET-000001' })).toContainText(
      'Annulé',
    );
    // Its lines are open again.
    await page.goto(`${URL_}?compte=401`);
    await expect(lines(page)).toHaveCount(2);
  });
});

test.describe('Permissions, sociétés, smart buttons', () => {
  test('14. accounting.read seul : consultation, aucune action ; sans lui, aucun écran', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, ['accounting.read', 'partners.read']);
    await page.goto(URL_);
    await expect(lines(page)).toHaveCount(6);
    await expect(page.getByText('consultation seule')).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Propositions' }).click();
    await expect(page.locator('.proposal')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Confirmer/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Lettrages' }).click();
    await page.getByRole('link', { name: 'LET-000001' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lettrage LET-000001');
    await expect(page.getByRole('button', { name: 'Délettrer' })).toHaveCount(0);

    api.withPermissions(COMPANY_A.public_id, ['partners.read']);
    await page.goto(URL_);
    await expect(page.getByRole('heading', { name: 'Lettrage', level: 1 })).toHaveCount(0);
    expect(api.callsTo('accounting/letterable-lines/').length).toBe(1);
  });

  test('15. changement de société : l’écran Lettrage, sans les filtres ni les lignes de A', async ({
    page,
  }) => {
    await page.goto(`${URL_}?compte=411`);
    await expect(lines(page)).toHaveCount(6);
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page.getByRole('button', { name: /^Société active/ })).toContainText(
      'FILIALE SÉNÉGAL (test)',
    );
    await expect(page).toHaveURL(/\/app\/comptabilite\/lettrage$/);
    await expect(page.getByText('Aucune ligne à lettrer.')).toBeVisible();
  });

  test('smart buttons : compte lettrable et tiers, compteur du serveur, vue préfiltrée', async ({
    page,
    api,
  }) => {
    const books = api.accounting.books('A');
    const account = books.accounts.find((item) => item.code === '411')!.public_id;
    await page.goto(`/app/comptabilite/plan-comptable/${account}`);
    const accountButton = page.getByRole('link', { name: /^Lettrage : / });
    await expect(accountButton).toHaveAccessibleName('Lettrage : 6');
    await accountButton.click();
    await expect(page).toHaveURL(/\/lettrage\?compte=411$/);
    await expect(lines(page)).toHaveCount(6);

    // A non letterable account: no lettering button.
    const expense = books.accounts.find((item) => item.code === '601')!.public_id;
    await page.goto(`/app/comptabilite/plan-comptable/${expense}`);
    await expect(page.getByRole('link', { name: /^Écritures/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Lettrage/ })).toHaveCount(0);

    const partner = api.partners.list('A').find((item) => item.code === 'CLI-001')!.public_id;
    await page.goto(`/app/comptabilite/clients/${partner}`);
    const partnerButton = page.getByRole('link', { name: /^Lettrage : / });
    await expect(partnerButton).toHaveAccessibleName('Lettrage : 4');
    await partnerButton.click();
    await expect(page).toHaveURL(/\/lettrage\?tiers=CLI-001$/);
    await expect(lines(page)).toHaveCount(4);
  });

  test('l’ancienne URL du lettrage des tiers mène à Lettrage', async ({ page }) => {
    await page.goto('/app/comptabilite/tiers/lettrage');
    await expect(page).toHaveURL(/\/app\/comptabilite\/lettrage$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lettrage');
  });

  test('un profil sans accounting.letter ne voit pas de case à cocher', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto(URL_);
    await expect(lines(page)).toHaveCount(6);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});

test.describe('Lettrage — accessibilité', () => {
  test('18. clavier seul : sélectionner, apercevoir, confirmer ; axe sans violation', async ({
    page,
  }) => {
    await page.goto(URL_);
    await expect(lines(page)).toHaveCount(6);
    const axe = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      );
    expect(await axe()).toEqual([]);

    await pick(page, 'VTE-000101').focus();
    await page.keyboard.press('Space');
    await pick(page, 'BQ1-000201').focus();
    await page.keyboard.press('Space');
    await expect(status(page)).toContainText('2 lignes sélectionnées');
    await page.getByRole('button', { name: 'Aperçu du lettrage' }).focus();
    await page.keyboard.press('Enter');
    await expect(preview(page).getByRole('heading')).toBeFocused();
    expect(await axe()).toEqual([]);
    await preview(page).getByRole('button', { name: 'Confirmer le lettrage' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Lettrage LET-000002 créé.')).toBeVisible();

    for (const tab of ['Propositions', 'Lettrages']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      await page.waitForLoadState('networkidle');
      expect(await axe(), tab).toEqual([]);
    }
    await page.getByRole('link', { name: 'LET-000001' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lettrage LET-000001');
    await page.waitForLoadState('networkidle');
    expect(await axe()).toEqual([]);
    await page.getByRole('button', { name: 'Délettrer' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Délettrer LET-000001 ?' });
    await expect(dialog.getByLabel('Motif')).toBeFocused();
    expect(await axe()).toEqual([]);
    await page.keyboard.type('Erreur');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Délettrer' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Lettrage annulé. Les lignes sont de nouveau ouvertes.'),
    ).toBeVisible();
  });
});
