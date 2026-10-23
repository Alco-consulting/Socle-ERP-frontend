import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, FakeApi, PROFILES, expect, test } from './support/fake-api';
import { fixToday } from './support/navigation';

/**
 * Relations between accounting objects (V2.1 A3): smart buttons of the journal, account and
 * partner records, the links of an entry, one ledger experience. Fake API only.
 */

const ACC = '/app/comptabilite';
const rows = (page: Page) => page.locator('tbody tr');
const smart = (page: Page, label: string) =>
  page.getByRole('link', { name: new RegExp(`^${label}( : \\d+)?$`) });
const countOf = async (page: Page, label: string) =>
  Number((await smart(page, label).getAttribute('aria-label'))?.split(': ')[1]);

const journalId = (api: FakeApi, code: string) =>
  api.accounting.books('A').journals.find((item) => item.code === code)!.public_id;
const accountId = (api: FakeApi, code: string) =>
  api.accounting.books('A').accounts.find((item) => item.code === code)!.public_id;
const partnerId = (api: FakeApi, code: string) =>
  api.partners.list('A').find((item) => item.code === code)!.public_id;
/** A posted entry of the bank journal: it accounts a treasury operation (fixture). */
const bankEntry = (api: FakeApi) =>
  api.entries
    .entries('A')
    .find((item) => item.journal.code === 'BQ1' && item.status === 'validated')!;

test.beforeEach(async ({ page }) => fixToday(page));

test.describe('Journal → objets liés', () => {
  test('1. Journal → Écritures : la liste du journal, de la même taille', async ({ page, api }) => {
    await page.goto(`${ACC}/journaux/${journalId(api, 'ACH')}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achats');
    const total = await countOf(page, 'Écritures');
    await smart(page, 'Écritures').click();
    await expect(page).toHaveURL(
      new RegExp(`/ecritures/pieces\\?journal=${journalId(api, 'ACH')}$`),
    );
    await expect(rows(page)).toHaveCount(total);
  });

  test('2. Journal → Historique : les événements de l’Audit, en lecture seule', async ({
    page,
    api,
  }) => {
    await page.goto(`${ACC}/journaux/${journalId(api, 'ACH')}`);
    await expect(smart(page, 'Historique')).toHaveAccessibleName('Historique : 1');
    await smart(page, 'Historique').click();
    await expect(page).toHaveURL(/#historique$/);
    const history = page.locator('#historique');
    await expect(history).toContainText('Création');
    await expect(history.getByRole('button')).toHaveCount(0); // read only
  });
});

test.describe('Compte → objets liés', () => {
  test('3. Compte → Écritures : filtrées par son code', async ({ page, api }) => {
    await page.goto(`${ACC}/plan-comptable/${accountId(api, '401')}`);
    const total = await countOf(page, 'Écritures');
    await smart(page, 'Écritures').click();
    await expect(page).toHaveURL(/\/ecritures\/pieces\?compte=401$/);
    await expect(rows(page)).toHaveCount(Math.min(total, 25));
  });

  test('4. Compte → Grand livre → écriture → compte : une seule expérience', async ({
    page,
    api,
  }) => {
    await page.goto(`${ACC}/plan-comptable/${accountId(api, '401')}`);
    await smart(page, 'Grand livre').click();
    await expect(page).toHaveURL(/\/analyse\/grand-livre\?compte=401&periode=annee$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand livre général');
    // The account alone, unfolded on its year (note backend 0053).
    const account = page.locator('tr.account-row');
    await expect(account).toHaveCount(1);
    await expect(account.locator('button.fold')).toHaveText(/401\s+Fournisseurs/);
    await expect(account.locator('button.fold')).toHaveAttribute('aria-expanded', 'true');
    const line = page.locator('tr.line').first();
    await expect(line).toBeVisible();
    const ledgerCall = api.callsTo(`reporting/ledger/${accountId(api, '401')}/`).at(-1)!;
    expect(new URL(ledgerCall.url()).searchParams.get('fiscal_year')).toBeTruthy();
    // Drill-down: the entry, then back to the account by its link.
    await line.getByRole('button', { name: /Actions de la ligne/ }).click();
    await page.getByRole('menuitem', { name: 'Voir la pièce' }).click();
    await expect(page).toHaveURL(/\/ecritures\/[^/?#]+$/);
    await page.getByRole('link', { name: '401', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/plan-comptable/${accountId(api, '401')}$`));
  });

  test('5. Compte → Historique', async ({ page, api }) => {
    await page.goto(`${ACC}/plan-comptable/${accountId(api, '401')}`);
    await smart(page, 'Historique').click();
    await expect(page).toHaveURL(/#historique$/);
    await expect(page.locator('#historique')).toContainText('Création');
  });
});

test.describe('Tiers → objets liés', () => {
  test('6. Tiers → Écritures : filtrées par son code', async ({ page, api }) => {
    await page.goto(`${ACC}/fournisseurs/${partnerId(api, 'FOU-001')}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Diallo et Cie');
    const total = await countOf(page, 'Écritures');
    expect(total).toBeGreaterThan(0);
    await smart(page, 'Écritures').click();
    await expect(page).toHaveURL(/\/ecritures\/pieces\?tiers=FOU-001$/);
    await expect(rows(page)).toHaveCount(Math.min(total, 25));
  });

  test('7. Tiers → Grand livre auxiliaire ; comptes collectifs ; lettrage ; échéances', async ({
    page,
    api,
  }) => {
    await page.goto(`${ACC}/fournisseurs/${partnerId(api, 'FOU-001')}`);
    await expect(smart(page, 'Comptes collectifs')).toHaveAccessibleName('Comptes collectifs : 1');
    await expect(page.locator('#comptes-collectifs')).toContainText(/Compte fournisseur\s*401/);
    // Échéances (V2.1 A5): a link, with the server's count of the partner's installments.
    await expect(smart(page, 'Échéances')).toHaveAccessibleName(/^Échéances : \d+$/);
    // Lettrage (V2.1 A4): a link, with the server's count of open lines (all lettered here).
    await expect(smart(page, 'Lettrage')).toHaveAccessibleName('Lettrage : 0');
    await smart(page, 'Grand livre auxiliaire').click();
    await expect(page).toHaveURL(/\/analyse\/grand-livre-auxiliaire\?tiers=FOU-001$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grand livre auxiliaire');
    await expect(page.getByText('FOU-001 — Diallo et Cie', { exact: true })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('8. Tiers → Historique', async ({ page, api }) => {
    await page.goto(`${ACC}/fournisseurs/${partnerId(api, 'FOU-001')}`);
    await smart(page, 'Historique').click();
    await expect(page).toHaveURL(/#historique$/);
    await expect(page.locator('#historique')).toContainText('Création');
  });
});

test.describe('Écriture → objets liés (par les public_id de l’API)', () => {
  test('9-11. Écriture → Journal, Compte, Tiers', async ({ page, api }) => {
    const entry = bankEntry(api);
    const url = `${ACC}/ecritures/${entry.public_id}`;
    await page.goto(url);
    await page.getByRole('link', { name: 'BQ1', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/journaux/${entry.journal.public_id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Banque principale');

    await page.goto(url);
    const account = entry.lines[0].account;
    await page.getByRole('link', { name: account.code, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/plan-comptable/${account.public_id}$`));

    await page.goto(url);
    await page.getByRole('link', { name: 'FOU-001', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${partnerId(api, 'FOU-001')}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Diallo et Cie');
  });

  test('12. Écriture → Trésorerie : l’opération qu’elle comptabilise', async ({ page, api }) => {
    const entry = bankEntry(api);
    await page.goto(`${ACC}/ecritures/${entry.public_id}`);
    await expect(page.getByText(/Opération du .* · BANK-GNF · VIR-/)).toBeVisible();
    const call = api.callsTo('treasury/operations/').at(-1)!;
    expect(new URL(call.url()).searchParams.get('accounting_entry')).toBe(entry.public_id);
    await page.getByRole('link', { name: 'Voir les opérations de trésorerie' }).click();
    await expect(page).toHaveURL(/\/tresorerie\/operations$/);
  });
});

test.describe('Société, permissions', () => {
  test('13. changement de société : ni fiche, ni compteur, ni filtre de la précédente', async ({
    page,
    api,
  }) => {
    await page.goto(`${ACC}/plan-comptable/${accountId(api, '401')}`);
    await expect(smart(page, 'Écritures')).toHaveAccessibleName(/Écritures : \d+/);
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ACC}/plan-comptable$`));
    await expect(page.locator('a.smart')).toHaveCount(0);
    await page.goto(`${ACC}/analyse/grand-livre?compte=401`);
    // Company B has no account 401: said, nothing of A.
    await expect(
      page.getByText('Aucun compte de cette société n’a le code « 401 ».'),
    ).toBeVisible();
    expect(api.callsTo(`reporting/ledger/${accountId(api, '401')}/`)).toHaveLength(0);
  });

  test('14. chaque smart button suit sa propre permission', async ({ page, api }) => {
    // Read only, without audit.read nor partners.read: entries and ledger, no history.
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto(`${ACC}/plan-comptable/${accountId(api, '401')}`);
    await expect(smart(page, 'Écritures')).toBeVisible();
    await expect(smart(page, 'Grand livre')).toBeVisible();
    await expect(smart(page, 'Historique')).toHaveCount(0);
    expect(api.callsTo(`audit/objects/accounting.account/${accountId(api, '401')}/`)).toHaveLength(
      0,
    );

    // Tiers only: the record, without any accounting relation asked.
    api.withPermissions(COMPANY_A.public_id, ['partners.read']);
    await page.goto(`/app/contacts/fournisseurs/${partnerId(api, 'FOU-001')}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Diallo et Cie');
    await expect(page.locator('.smart-buttons')).toHaveCount(0);
    expect(api.callsTo(`accounting/partners/${partnerId(api, 'FOU-001')}/accounts/`)).toHaveLength(
      0,
    );
  });

  test('17. accessibilité : fiches et grand livre sans violation, smart buttons au clavier', async ({
    page,
    api,
  }) => {
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
      ).violations.map((violation) => violation.id);
    for (const url of [
      `${ACC}/plan-comptable/${accountId(api, '401')}`,
      `${ACC}/fournisseurs/${partnerId(api, 'FOU-001')}`,
      `${ACC}/analyse/grand-livre?compte=401`,
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await scan(), url).toEqual([]);
    }
    // Keyboard: the smart buttons are links.
    await page.goto(`${ACC}/fournisseurs/${partnerId(api, 'FOU-001')}`);
    const entries = smart(page, 'Écritures');
    await entries.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/ecritures\/pieces\?tiers=FOU-001$/);
  });
});
