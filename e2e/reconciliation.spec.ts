import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';
import { fixToday, openMenuItem } from './support/navigation';

/**
 * Comptabilité › Trésorerie › Rapprochements (V2.1, lots A6, A6.1, A6.2) against the fake
 * API: bank lines per state, a line's record and reconciliations, the server's proposals and
 * their confirmation (with or without the invoice), a stale proposal, the cancellation of a
 * reconciliation — the bank relation only, the lettering kept —, permissions, company change,
 * session end, three screen sizes and accessibility. The fake answers from explicit fixtures
 * (e2e/support/fake-treasury.ts): no matching is played anywhere.
 */

const URL_ = '/app/comptabilite/tresorerie/rapprochements';
const BANK = `${URL_}?compte=BQ-GNF`;
const rows = (page: Page) => page.locator('alco-statement-lines alco-table tbody tr');
const panel = (page: Page) => page.getByRole('region', { name: /^Ligne du / });
const proposals = (page: Page) => page.locator('.proposal');
const openLine = (page: Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^Ouvrir la ligne du .*${label}`) }).click();
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );

test.beforeEach(async ({ page }) => fixToday(page));

test.describe('Rapprochement — lignes', () => {
  test('1. ouvrir Rapprochement depuis le menu, choisir le compte : les lignes du serveur', async ({
    page,
    api,
  }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await openMenuItem(page, 'Comptabilité', 'Rapprochement');
    await expect(page).toHaveURL(/\/app\/comptabilite\/tresorerie\/rapprochements$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rapprochement bancaire');
    await expect(page.getByText('Choisissez le compte de trésorerie à rapprocher.')).toBeVisible();
    expect(api.callsTo('treasury/statement-lines/')).toHaveLength(0);

    await page.getByRole('combobox', { name: 'Compte de trésorerie' }).selectOption('BQ-GNF');
    await page.getByRole('button', { name: 'Afficher' }).click();
    await expect(page).toHaveURL(/compte=BQ-GNF/);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByText('3 lignes')).toBeVisible();
    await expect(rows(page).first()).toContainText('VIR CLIENT CLI-001 FAC-101');
    await expect(rows(page).first()).toContainText('Non rapprochée');
    const call = api.callsTo('treasury/statement-lines/').at(-1)!;
    expect(new URL(call.url()).searchParams.get('status')).toBe('unreconciled');
    // Breadcrumb: Comptabilité › Trésorerie › Rapprochements.
    await expect(page.getByRole('navigation', { name: /fil d’Ariane/i })).toContainText(
      'Trésorerie',
    );
  });

  test('l’URL garde le compte, le relevé et la vue au rechargement', async ({ page, api }) => {
    await page.goto(BANK);
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole('combobox', { name: 'Relevé' }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Afficher' }).click();
    await expect(page).toHaveURL(/releve=/);
    await page.getByRole('tab', { name: 'Exclues' }).click();
    await expect(rows(page)).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Exclues' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(rows(page)).toHaveCount(1);
    const call = api.callsTo('treasury/statement-lines/').at(-1)!;
    expect(new URL(call.url()).searchParams.get('statement')).toBeTruthy();
  });

  test('2. ouvrir une ligne : ses champs et ses rapprochements, rien d’inventé', async ({
    page,
  }) => {
    await page.goto(BANK);
    await openLine(page, 'FRAIS BANCAIRES');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText('Ligne du 15/09/2026');
    await expect(panel(page)).toContainText('TX-103');
    await expect(panel(page)).toContainText('Aucun rapprochement pour cette ligne.');
    await page.getByRole('button', { name: 'Fermer' }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('vues : rapprochées et exclues, chacune son état au serveur', async ({ page }) => {
    await page.goto(BANK);
    await page.getByRole('tab', { name: 'Exclues' }).click();
    await expect(page).toHaveURL(/vue=exclues/);
    await expect(rows(page)).toHaveCount(1);
    await openLine(page, 'COMMISSION CONTESTÉE');
    await expect(panel(page)).toContainText('Commission contestée auprès de la banque');
    await page.getByRole('tab', { name: 'Rapprochées' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Rapprochée');
  });

  test('13. une erreur du serveur est dite, avec Réessayer', async ({ page }) => {
    let failures = 1;
    await page.route('**/api/v1/treasury/statement-lines/**', async (route) => {
      if (failures-- > 0) {
        await route.fulfill({
          status: 500,
          json: {
            error: { code: 'server_error', message: 'x', details: null, correlation_id: 'e2e' },
          },
        });
      } else {
        await route.fallback();
      }
    });
    await page.goto(BANK);
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect(rows(page)).toHaveCount(3);
  });
});

test.describe('Rapprochement — propositions', () => {
  test('3. les propositions du serveur : montants, écart, critères, facture réglable', async ({
    page,
  }) => {
    await page.goto(BANK);
    await openLine(page, 'VIR CLIENT CLI-001');
    await page.getByRole('button', { name: 'Voir les propositions' }).click();
    await expect(page).toHaveURL(/vue=propositions/);
    await expect(proposals(page)).toHaveCount(2);
    const first = proposals(page).first();
    await expect(first).toContainText('Ligne de relevé');
    await expect(first).toContainText('Opération proposée');
    await expect(first).toContainText('1 200 000');
    await expect(first).toContainText('Seule correspondance possible sur le compte');
    await expect(first).toContainText('Même référence');
    await expect(first).toContainText('2 jours');
    await expect(first).toContainText('VTE-000101');
    await expect(first).toContainText('Proposée, non rapprochée');
    await expect(proposals(page).nth(1)).not.toContainText('Facture réglable');
  });

  test('4. aucune proposition : aucune n’est fabriquée', async ({ page }) => {
    await page.goto(`${URL_}?compte=CAISSE&vue=propositions`);
    await expect(page.getByText('Aucune proposition de rapprochement.')).toBeVisible();
    await expect(proposals(page)).toHaveCount(0);
  });

  test('5-7. confirmer avec la facture : rapprochement et lettrage du serveur, listes relues', async ({
    page,
    api,
  }) => {
    await page.goto(`${BANK}&vue=propositions`);
    await expect(proposals(page)).toHaveCount(2);
    await proposals(page)
      .first()
      .getByRole('checkbox', { name: /Régler aussi cette facture/ })
      .check();
    await expect(page.getByText('1 proposition sélectionnée')).toBeVisible();
    await page.getByRole('button', { name: 'Rapprocher la sélection' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Rapprocher la ligne ?' });
    await expect(dialog).toContainText('La facture sera réglée par le lettrage');
    await dialog.getByRole('button', { name: 'Rapprocher la ligne' }).click();
    await expect(page.getByText('Ligne rapprochée.')).toBeVisible();
    const outcome = page.getByRole('region', { name: 'Rapprochements confirmés' });
    await expect(outcome).toContainText('Ligne du 10/09/2026');
    await expect(outcome.getByRole('link', { name: /^LET-/ })).toBeVisible();
    // The server's request, then its proposals again: only the other one is left.
    const call = api.callsTo('treasury/reconciliation-proposals/confirm/').at(-1)!;
    const body = call.postDataJSON() as { items: { invoice_line?: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].invoice_line).toBeTruthy();
    await expect(proposals(page)).toHaveCount(1);
    expect(api.treasury.line('A', 'B1').status).toBe('reconciled');

    // 6. The line is now among the reconciled ones, with its reconciliation and lettering.
    await page.getByRole('tab', { name: 'Rapprochées' }).click();
    await expect(rows(page)).toHaveCount(2);
    await openLine(page, 'VIR CLIENT CLI-001');
    await expect(panel(page)).toContainText('Rapprochement actif');
    await expect(panel(page)).toContainText('Lettrage actif');
  });

  test('confirmer sans la facture : aucun invoice_line, aucun lettrage', async ({ page, api }) => {
    await page.goto(`${BANK}&vue=propositions`);
    await proposals(page)
      .nth(1)
      .getByRole('checkbox', { name: /^Sélectionner/ })
      .check();
    await page.getByRole('button', { name: 'Rapprocher la sélection' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Aucune facture ne sera lettrée.');
    await dialog.getByRole('button', { name: 'Rapprocher la ligne' }).click();
    await expect(page.getByText('Ligne rapprochée.')).toBeVisible();
    const body = api
      .callsTo('treasury/reconciliation-proposals/confirm/')
      .at(-1)!
      .postDataJSON() as {
      items: object[];
    };
    expect(body.items).toEqual([
      {
        line: api.treasury.line('A', 'B2').public_id,
        operation: expect.any(String),
      },
    ]);
  });

  test('11. proposition devenue obsolète : treasury_reconciliation_proposal_stale, relue', async ({
    page,
    api,
  }) => {
    await page.goto(`${BANK}&vue=propositions`);
    await expect(proposals(page)).toHaveCount(2);
    api.treasury.reconcileBehind('A', 'B1');
    await proposals(page)
      .first()
      .getByRole('checkbox', { name: /^Sélectionner/ })
      .check();
    await page.getByRole('button', { name: 'Rapprocher la sélection' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Rapprocher la ligne' })
      .click();
    await expect(page.getByText('Cette proposition n’est plus valable.')).toBeVisible();
    await expect(proposals(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Rapprocher la sélection' })).toHaveCount(0);
  });
});

test.describe('Rapprochement — dé-rapprochement (A6.1)', () => {
  test('7, 15. ligne rapprochée : opération, lettrage lié et sa fiche', async ({ page }) => {
    await page.goto(`${BANK}&vue=rapprochees`);
    await openLine(page, 'VIR CLI-003');
    await expect(panel(page)).toContainText('Rapprochement actif');
    await expect(panel(page)).toContainText('04/09/2026 · VIR-099 · CLI-003');
    await expect(panel(page)).toContainText('Lettrage actif');
    await panel(page).getByRole('link', { name: 'LET-000001' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lettrage LET-000001');
  });

  test('8-10. dé-rapprocher : motif exigé, lien bancaire seul annulé, lettrage resté actif', async ({
    page,
    api,
  }) => {
    await page.goto(`${BANK}&vue=rapprochees`);
    await openLine(page, 'VIR CLI-003');
    await panel(page).getByRole('button', { name: 'Dé-rapprocher' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dé-rapprocher la ligne du 05/09/2026 ?' });
    await expect(dialog).toContainText('l’opération de trésorerie et son écriture comptable');
    await expect(dialog).toContainText('le lettrage LET-000001 et les échéances qu’il a réglées');
    await expect(dialog).not.toContainText(/supprim|délettre automatiquement/i);
    // 10. The reason is required.
    await dialog.getByRole('button', { name: 'Dé-rapprocher' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Indiquez le motif de l’annulation du rapprochement.',
    );
    expect(
      api.callsTo(
        `treasury/reconciliations/${api.treasury.reconciliations('A')[0].public_id}/cancel/`,
      ),
    ).toHaveLength(0);
    await dialog.getByLabel('Motif').fill('Mauvaise ligne de relevé');
    await dialog.getByRole('button', { name: 'Dé-rapprocher' }).click();
    await expect(page.getByText('Rapprochement annulé.')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'de nouveau à rapprocher' }),
    ).toContainText('Le lettrage LET-000001 reste actif : la facture reste réglée.');
    await expect(rows(page)).toHaveCount(0);
    expect(api.lettering.letterings('A')[0].status).toBe('active');

    // 8. The cancelled reconciliation, from the line now to reconcile again.
    await page.getByRole('tab', { name: 'À rapprocher' }).click();
    await openLine(page, 'VIR CLI-003');
    await expect(panel(page)).toContainText('Rapprochement annulé');
    await expect(panel(page)).toContainText('Mauvaise ligne de relevé');
    await expect(panel(page)).toContainText('L’annulation n’a défait que le lien bancaire');
    await expect(panel(page).getByRole('button', { name: 'Dé-rapprocher' })).toHaveCount(0);
    await expect(panel(page)).toContainText('Annulation du rapprochement bancaire');
  });
});

test.describe('Rapprochement — permissions, sociétés, session', () => {
  test('12. lecture seule : ni sélection ni dé-rapprochement ; sans treasury.read, aucun écran', async ({
    page,
    api,
  }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer);
    await page.goto(`${BANK}&vue=rapprochees`);
    await openLine(page, 'VIR CLI-003');
    await expect(panel(page)).toContainText('Rapprochement actif');
    await expect(page.getByRole('button', { name: 'Dé-rapprocher' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Propositions' }).click();
    await expect(proposals(page)).toHaveCount(2);
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    api.withPermissions(COMPANY_A.public_id, ['accounting.read']);
    await page.goto(BANK);
    await expect(
      page.getByRole('heading', { name: 'Rapprochement bancaire', level: 1 }),
    ).toHaveCount(0);
  });

  test('14. changement de société : l’écran, sans le compte ni les lignes de A', async ({
    page,
  }) => {
    await page.goto(BANK);
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole('button', { name: /^Société active/ }).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page.getByRole('button', { name: /^Société active/ })).toContainText(
      'FILIALE SÉNÉGAL (test)',
    );
    await expect(page).toHaveURL(/\/app\/comptabilite\/tresorerie\/rapprochements$/);
    await expect(page.getByText('Choisissez le compte de trésorerie à rapprocher.')).toBeVisible();
    await page.getByRole('combobox', { name: 'Compte de trésorerie' }).selectOption('BQ-XOF');
    await page.getByRole('button', { name: 'Afficher' }).click();
    await expect(page.getByText('Aucune ligne à rapprocher.')).toBeVisible();
  });

  test('session expirée : retour à la connexion', async ({ page, api }) => {
    await page.goto(BANK);
    await expect(rows(page)).toHaveCount(3);
    api.treasury.expireSession();
    await page.getByRole('tab', { name: 'Propositions' }).click();
    await expect(page).toHaveURL(/\/login\?raison=session-expiree/);
  });
});

test.describe('Rapprochement — tailles d’écran et accessibilité', () => {
  for (const [name, width, height] of [
    ['bureau', 1440, 900],
    ['tablette', 820, 1180],
    ['téléphone', 390, 844],
  ] as const) {
    test(`16. ${name} : aucun défilement horizontal, ligne et propositions utilisables`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(BANK);
      await openLine(page, 'VIR CLIENT CLI-001');
      await expect(panel(page)).toBeVisible();
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: 'Voir les propositions' }).click();
      await expect(proposals(page)).toHaveCount(2);
      await proposals(page)
        .first()
        .getByRole('checkbox', { name: /^Sélectionner/ })
        .check();
      await expect(page.getByRole('button', { name: 'Rapprocher la sélection' })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  }

  test('17. clavier seul et axe sans violation : liste, ligne, propositions, dialogue', async ({
    page,
  }) => {
    await page.goto(`${BANK}&vue=rapprochees`);
    await expect(rows(page)).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
    await page.getByRole('button', { name: /^Ouvrir la ligne du .*VIR CLI-003/ }).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toContainText('Rapprochement actif');
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
    await panel(page).getByRole('button', { name: 'Dé-rapprocher' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /^Dé-rapprocher la ligne/ });
    await expect(dialog.getByLabel('Motif')).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('tab', { name: 'Rapprochées' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Propositions' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(proposals(page)).toHaveCount(2);
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
    await proposals(page)
      .first()
      .getByRole('checkbox', { name: /^Sélectionner/ })
      .focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Rapprocher la sélection' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});
