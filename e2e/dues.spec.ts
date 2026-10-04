import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, FakeApi, PROFILES, expect, test } from './support/fake-api';
import { fixToday, openMenuItem } from './support/navigation';

/**
 * Échéances and the aged balance (V2.1, lot A5) against the fake API: installments,
 * pending invoices and their generation, a schedule and its recomputation, the customers' and
 * suppliers' aged balance on a chosen reference date, drill-down down to the entry, the
 * company's buckets, permissions, company change, accessibility. The fake answers from
 * explicit fixtures (e2e/support/fake-dues.ts): nothing is computed, neither here nor there.
 */

const ACC = '/app/comptabilite';
const DUES = `${ACC}/echeances`;
const CUSTOMERS = `${ACC}/analyse/balance-clients`;
const rows = (page: Page) => page.locator('.wide tbody tr');

async function chooseDate(page: Page, day: string): Promise<void> {
  await page.getByLabel('Date de référence').fill(day);
  await page.getByRole('button', { name: 'Afficher la balance' }).click();
}

test.beforeEach(async ({ page }) => fixToday(page));

test.describe('Échéances', () => {
  test('1-3. ouvrir, filtrer par tiers, ouvrir une échéance et ses règlements', async ({
    page,
  }) => {
    await page.goto(`${ACC}/tableau-de-bord`);
    await openMenuItem(page, 'Comptabilité', 'Échéances');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Échéances');
    await expect(rows(page)).toHaveCount(3);

    await page.getByRole('button', { name: 'Filtres' }).click();
    const filters = page.getByRole('dialog', { name: 'Filtres' });
    await filters.getByRole('textbox', { name: 'Tiers' }).fill('CLI-001');
    await filters.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/tiers=CLI-001/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Partiellement réglée');

    await rows(page).first().getByRole('link', { name: '01/04/2026' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Échéance du 01/04/2026');
    await expect(page.getByText('600 000 GNF').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'LET-000001' })).toBeVisible();
  });

  test('4. générer les échéances d’une facture en attente, confirmé', async ({ page, api }) => {
    await page.goto(`${DUES}?vue=a-generer`);
    await expect(rows(page)).toHaveCount(2);
    const first = api.dues.pending('A')[0];
    await page
      .locator('.wide')
      .getByRole('checkbox', { name: `Sélectionner ${first.entry.entry_number} CLI-001` })
      .check();
    await page.getByRole('button', { name: 'Générer les échéances' }).click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Générer les échéances de cette facture ?',
    });
    await dialog.getByRole('button', { name: 'Générer les échéances' }).click();
    await expect(page.getByText('Échéancier généré.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Échéanciers générés' })).toContainText(
      `${first.entry.entry_number} · CLI-001`,
    );
    await expect(rows(page)).toHaveCount(1);
    expect(api.dues.pending('A')).toHaveLength(1);
  });

  test('5. recalculer un échéancier, avec confirmation et motif', async ({ page, api }) => {
    const schedule = api.dues.schedules('A')[0];
    await page.goto(`${DUES}/echeanciers/${schedule.public_id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Échéancier ${schedule.entry.entry_number}`,
    );
    await expect(page.getByText('100.0000 % à 30 j')).toBeVisible();
    await page.getByRole('button', { name: 'Recalculer' }).click();
    const dialog = page.getByRole('dialog', { name: /^Recalculer l’échéancier/ });
    await expect(dialog).toContainText('Les échéances existantes seront recalculées');
    await dialog.getByRole('button', { name: 'Recalculer' }).click();
    await expect(dialog.getByText('Indiquez le motif du recalcul.')).toBeVisible();
    await dialog.getByLabel('Motif').fill('Conditions renégociées');
    await dialog.getByRole('button', { name: 'Recalculer' }).click();
    await expect(page.getByText('Échéancier recalculé.')).toBeVisible();
    await expect(page.getByText('Dernier recalcul')).toBeVisible();
    await expect(page.locator('#historique')).toContainText('Modification');
  });
});

test.describe('Balance âgée', () => {
  test('6-11. clients : date choisie, synthèse, tiers, échéance, écriture', async ({
    page,
    api,
  }) => {
    await page.goto(`${ACC}/tableau-de-bord`);
    await openMenuItem(page, 'Analyse', 'Balance clients');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Balance âgée clients');
    await expect(page.getByText('Choisissez la date de référence.')).toBeVisible();
    expect(api.callsTo('reporting/aged-balance/')).toHaveLength(0); // nothing before confirming

    await chooseDate(page, '2026-04-15');
    await expect(page).toHaveURL(/au=2026-04-15/);
    const summary = page.locator('alco-aged-summary');
    await expect(summary).toContainText('Situation au 15/04/2026');
    await expect(summary).toContainText('Devise : GNF');
    await expect(summary).toContainText('Factures sans échéancier');
    await expect(summary).toContainText('Non affecté');
    await expect(rows(page)).toHaveCount(2);

    await rows(page)
      .first()
      .getByRole('link', { name: /^CLI-001, de 1 à 30 jours de retard/ })
      .click();
    await expect(page).toHaveURL(/balance-clients\/[^?]+\?au=2026-04-15&tranche=1-30/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^CLI-001/);
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().getByRole('link', { name: '01/04/2026' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Échéance du 01/04/2026');
    const entry = api.dues.items('A')[0].entry;
    await page.getByRole('link', { name: entry.entry_number }).click();
    await expect(page).toHaveURL(new RegExp(`/ecritures/${entry.public_id}$`));
  });

  test('12. fournisseurs : leur propre rapport', async ({ page, api }) => {
    await page.goto(`${ACC}/analyse/balance-fournisseurs?au=2026-04-15`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Balance âgée fournisseurs');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('FOU-001');
    const call = api.callsTo('reporting/aged-balance/').at(-1)!;
    expect(new URL(call.url()).searchParams.get('role')).toBe('supplier');
  });

  test('13. modifier les tranches : la balance montre celles du serveur', async ({ page }) => {
    await page.goto(`${ACC}/configuration/balance-agee`);
    await expect(page.getByText('Tranches par défaut d’Alco')).toBeVisible();
    await page.getByRole('button', { name: 'Retirer la limite 4' }).click();
    await page.getByRole('button', { name: 'Retirer la limite 3' }).click();
    await page.getByLabel('Limite 1 (jours)').fill('15');
    await page.getByLabel('Limite 2 (jours)').fill('45');
    await page.getByRole('button', { name: 'Enregistrer les tranches' }).click();
    await page
      .getByRole('alertdialog', { name: 'Enregistrer ces tranches ?' })
      .getByRole('button', { name: 'Enregistrer les tranches' })
      .click();
    await expect(page.getByText('Tranches enregistrées.')).toBeVisible();
    await expect(page.getByText('Tranches propres à la société.')).toBeVisible();

    await page.goto(`${CUSTOMERS}?au=2026-04-15`);
    await expect(page.locator('.wide thead th')).toHaveText([
      'Tiers',
      'Non échue',
      '1–15 j',
      '16–45 j',
      'Plus de 45 j',
      'Total',
      'Solde',
    ]);
  });
});

test.describe('Permissions, sociétés, smart button', () => {
  test('14. lecture seule : ni génération, ni recalcul, ni tranches modifiables', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto(`${DUES}?vue=a-generer`);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('consultation seule')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Générer les échéances' })).toHaveCount(0);
    await page.goto(`${DUES}/echeanciers/${api.dues.schedules('A')[0].public_id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recalculer' })).toHaveCount(0);
  });

  test('15. gestion : génération et tranches proposées ; sans état auxiliaire, pas de balance', async ({
    page,
    api,
  }) => {
    await page.goto(`${ACC}/configuration/balance-agee`);
    await expect(page.getByRole('button', { name: 'Enregistrer les tranches' })).toBeVisible();
    api.withPermissions(COMPANY_A.public_id, ['accounting.read', 'reporting.read']);
    await page.goto(`${CUSTOMERS}?au=2026-04-15`);
    await expect(page.getByRole('heading', { name: 'Balance âgée clients' })).toHaveCount(0);
    expect(api.callsTo('reporting/aged-balance/')).toHaveLength(0);
  });

  test('16. changement de société : la liste, sans les échéances ni les filtres de A', async ({
    page,
  }) => {
    await page.goto(`${DUES}?tiers=CLI-001`);
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page.getByRole('button', { name: /^Société active/ })).toContainText(
      'FILIALE SÉNÉGAL (test)',
    );
    await expect(page).toHaveURL(/\/app\/comptabilite\/echeances$/);
    await expect(page.getByText('Aucune échéance dans cette société.')).toBeVisible();
  });

  test('fiche Tiers : Échéances avec le compteur du serveur, vers la liste filtrée', async ({
    page,
    api,
  }) => {
    const partner = api.partners.list('A').find((item) => item.code === 'CLI-001')!;
    await page.goto(`${ACC}/clients/${partner.public_id}`);
    const button = page.getByRole('link', { name: /^Échéances : / });
    await expect(button).toHaveAccessibleName('Échéances : 1');
    await button.click();
    await expect(page).toHaveURL(/\/echeances\?tiers=CLI-001$/);
    await expect(rows(page)).toHaveCount(1);
  });
});

const scan = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );

test.describe('19. accessibilité', () => {
  const screens: [string, (api: FakeApi) => string][] = [
    ['Échéances', () => DUES],
    ['Échéances à générer', () => `${DUES}?vue=a-generer`],
    ['Fiche d’échéance', (api) => `${DUES}/${api.dues.items('A')[0].public_id}`],
    ['Échéancier', (api) => `${DUES}/echeanciers/${api.dues.schedules('A')[0].public_id}`],
    ['Balance sans date', () => CUSTOMERS],
    ['Balance au 15/04/2026', () => `${CUSTOMERS}?au=2026-04-15`],
    ['Tranches', () => `${ACC}/configuration/balance-agee`],
  ];
  for (const [name, url] of screens) {
    test(`${name} : axe sans violation`, async ({ page, api }) => {
      await page.goto(url(api));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await scan(page)).toEqual([]);
    });
  }

  test('date de référence et drill-down au clavier', async ({ page }) => {
    await page.goto(CUSTOMERS);
    // The labelled date field submits with Enter (the button follows it in the tab order).
    await page.getByLabel('Date de référence').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('alco-aged-summary')).toBeVisible();
    await page.getByRole('link', { name: 'CLI-001' }).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^CLI-001/);
    await page.waitForLoadState('networkidle');
    expect(await scan(page)).toEqual([]);
  });
});

test.describe('A5.1 — une tranche : la liste complète et paginée du serveur', () => {
  test('1-2. plus de 200 échéances dans une tranche : toutes, page après page', async ({
    page,
    api,
  }) => {
    await page.goto(`${CUSTOMERS}?au=2026-04-15`);
    await rows(page)
      .filter({ hasText: 'CLI-002' })
      .getByRole('link', { name: /^CLI-002, non échue/ })
      .click();
    await expect(page).toHaveURL(/tranche=not_due/);
    await expect(page.getByRole('status')).toHaveText('Tranche Non échue : 260 échéances');
    await expect(rows(page)).toHaveCount(200);
    const call = api
      .callsTo(
        `reporting/aged-balance/partners/${api.partners.list('A').find((item) => item.code === 'CLI-002')!.public_id}/`,
      )
      .at(-1)!;
    expect(new URL(call.url()).searchParams.get('bucket')).toBe('not_due');
    await page.getByRole('button', { name: /Page suivante/ }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(rows(page)).toHaveCount(60);
    await expect(page.locator('.bucket-nav [aria-current="page"]')).toHaveText('Non échue');
  });

  test('3-4. changer de tranche puis de tiers : chaque fois la liste du serveur', async ({
    page,
    api,
  }) => {
    const other = api.partners.list('A').find((item) => item.code === 'CLI-002')!;
    await page.goto(`${CUSTOMERS}/${other.public_id}?au=2026-04-15&tranche=not_due&page=2`);
    await expect(rows(page)).toHaveCount(60);
    await page.locator('.bucket-nav').getByRole('link', { name: 'Tous les documents' }).click();
    await expect(page).not.toHaveURL(/tranche=/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByRole('status')).toHaveText('1 document ouvert');

    const first = api.partners.list('A').find((item) => item.code === 'CLI-001')!;
    await page.goto(`${CUSTOMERS}/${first.public_id}?au=2026-04-15&tranche=1-30`);
    await expect(page.getByRole('status')).toHaveText('Tranche 1–30 j : 1 échéance');
    await expect(rows(page)).toHaveCount(1);
  });

  test('5-6. une autre date garde le tiers et la tranche ; une autre société, rien de A', async ({
    page,
    api,
  }) => {
    await page.goto(`${CUSTOMERS}?au=2026-04-15`);
    await chooseDate(page, '2026-05-31');
    await expect(page).toHaveURL(/au=2026-05-31/);
    const link = rows(page)
      .filter({ hasText: 'CLI-002' })
      .getByRole('link', {
        name: /^CLI-002, non échue/,
      });
    await expect(link).toHaveAttribute('href', /au=2026-05-31&tranche=not_due/);
    await link.click();
    await expect(page.getByRole('status')).toHaveText('Tranche Non échue : 260 échéances');
    const call = api
      .callsTo(
        `reporting/aged-balance/partners/${api.partners.list('A').find((item) => item.code === 'CLI-002')!.public_id}/`,
      )
      .at(-1)!;
    expect(new URL(call.url()).searchParams.get('as_of')).toBe('2026-05-31');

    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page.getByRole('button', { name: /^Société active/ })).toContainText(
      'FILIALE SÉNÉGAL (test)',
    );
    await expect(page).toHaveURL(/\/analyse\/balance-clients$/);
    await expect(page.getByText('Choisissez la date de référence.')).toBeVisible();
  });

  test('7. sans état auxiliaire, aucune tranche n’est lue', async ({ page, api }) => {
    const other = api.partners.list('A').find((item) => item.code === 'CLI-002')!;
    api.withPermissions(COMPANY_A.public_id, ['accounting.read', 'reporting.read']);
    await page.goto(`${CUSTOMERS}/${other.public_id}?au=2026-04-15&tranche=not_due`);
    await expect(page.getByRole('heading', { name: /CLI-002/ })).toHaveCount(0);
    expect(api.callsTo(`reporting/aged-balance/partners/${other.public_id}/`)).toHaveLength(0);
  });

  test('9. accessibilité de la tranche : navigation nommée, page courante, axe', async ({
    page,
    api,
  }) => {
    const other = api.partners.list('A').find((item) => item.code === 'CLI-002')!;
    await page.goto(`${CUSTOMERS}/${other.public_id}?au=2026-04-15&tranche=not_due`);
    await expect(rows(page)).toHaveCount(200);
    await expect(page.getByRole('navigation', { name: 'Tranches du tiers' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await scan(page)).toEqual([]);
  });
});
