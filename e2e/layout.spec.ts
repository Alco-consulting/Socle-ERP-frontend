import { expect, test } from './support/fake-api';

const SCREENS = [
  { name: 'App Launcher', url: '/' },
  { name: 'Tableau de bord', url: '/app/comptabilite/tableau-de-bord' },
  { name: 'Écritures comptables', url: '/app/comptabilite/ecritures' },
  { name: 'Liste', url: '/app/comptabilite/ecritures/pieces' },
  { name: 'Journaux', url: '/app/comptabilite/journaux' },
  { name: 'Lettrage', url: '/app/comptabilite/lettrage' },
  { name: 'Échéances', url: '/app/comptabilite/echeances' },
  { name: 'Balance âgée', url: '/app/comptabilite/analyse/balance-clients?au=2026-04-15' },
  { name: 'Analyse', url: '/app/comptabilite/analyse/balance' },
  { name: 'Nouvelle écriture', url: '/app/comptabilite/ecritures/nouvelle' },
  { name: 'Trésorerie (domaine de Comptabilité)', url: '/app/comptabilite/tresorerie/operations' },
  { name: 'Import d’écritures', url: '/app/comptabilite/ecritures/import' },
  { name: 'Taxes', url: '/app/comptabilite/taxes/liste' },
  { name: 'Nouvelle taxe', url: '/app/comptabilite/taxes/liste/nouveau' },
  { name: 'Clôture', url: '/app/comptabilite/cloture' },
  { name: 'Tiers', url: '/app/tiers/liste' },
  { name: 'Catalogue', url: '/design-system' },
];

// Runs on the desktop, tablet and phone projects (playwright.config.ts).
test.describe('Règles de mise en page', () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: no global sidebar, no horizontal page scroll`, async ({ page }) => {
      await page.goto(screen.url);
      await expect(page.locator('#contenu')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      // No permanent side navigation anywhere.
      await expect(page.locator('aside')).toHaveCount(0);
      const navs = await page.getByRole('navigation').all();
      for (const nav of navs) {
        const box = await nav.boundingBox();
        if (box && box.height > 0) {
          expect(box.height, 'a navigation is horizontal, never a tall side column').toBeLessThan(
            120,
          );
        }
      }

      // Wide content (tables) scrolls inside its own frame, never the page.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('inside an application: top bar with company, then the module navigation', async ({
    page,
  }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
    await expect(
      page.getByRole('button', { name: /Société active : ALCO GUINÉE \(test\)/ }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Toutes les applications' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigation Comptabilité' })).toBeVisible();
  });

  test('the grouped menus of Comptabilité stay usable at every width', async ({
    page,
  }, testInfo) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(page.locator('.card').first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navigation Comptabilité' });
    const groups = () => page.getByRole('menu').getByRole('group');
    if (testInfo.project.name === 'desktop') {
      await nav.getByRole('button', { name: 'Configuration', exact: true }).click();
      await expect(groups()).toHaveCount(8);
    } else if (testInfo.project.name === 'tablet') {
      // keep = 4: Tableau de bord, Clients, Fournisseurs, Comptabilité ▾, then « Plus ▾ ».
      await expect(nav.getByRole('button', { name: 'Comptabilité', exact: true })).toBeVisible();
      await nav.getByRole('button', { name: 'Plus', exact: true }).click();
      await expect(groups().first()).toHaveAccessibleName('Analyse · Rapports financiers');
      await expect(page.getByRole('group', { name: 'Configuration · Banques' })).toBeVisible();
    } else {
      // One menu named after the current screen, still grouped under titles.
      await page.getByRole('button', { name: 'Navigation Comptabilité : Tableau de bord' }).click();
      await expect(page.getByRole('group', { name: 'Comptabilité', exact: true })).toBeVisible();
      await expect(
        page.getByRole('group', { name: 'Analyse · Rapports comptables' }),
      ).toBeVisible();
    }
    // The open menu fits the screen (it scrolls inside itself when long).
    const box = await page.getByRole('menu').boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.x + box.width <= viewport.width + 1).toBe(true);
    expect(box && viewport && box.y + box.height <= viewport.height + 1).toBe(true);
    await page
      .getByRole('menu')
      .getByRole('menuitemradio', { name: 'Paramètres comptables' })
      .click();
    await expect(page).toHaveURL(/\/app\/comptabilite\/configuration\/parametres$/);
  });

  test('a closing: its steps and actions fit every width', async ({ page, api }) => {
    const year = api.accounting.books('A').years.find((item) => item.status === 'open')!;
    const run = api.closing.open('A', year.public_id, year.code);
    await page.goto(`/app/comptabilite/cloture/${run.public_id}`);
    await expect(page.locator('.step')).toHaveCount(10);
    await expect(page.locator('.step-action')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the dashboard cards: figures reachable, no overflow at every width', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(page.locator('alco-due-bars .bar')).toHaveCount(12);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const drafts = page
      .locator('.card', { has: page.locator('.card-title', { hasText: 'Ventes' }) })
      .getByRole('link', { name: '1 À valider' });
    await drafts.scrollIntoViewIfNeeded();
    await drafts.click();
    await expect(page).toHaveURL(/etat=draft$/);
  });

  test('lettering: a table from the tablet up, cards on a phone; the selection at hand', async ({
    page,
  }, testInfo) => {
    await page.goto('/app/comptabilite/lettrage');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lettrage');
    const phone = testInfo.project.name === 'phone';
    const scope = phone ? page.locator('.cards') : page.locator('.wide');
    await expect(scope).toBeVisible();
    await expect(phone ? page.locator('.wide') : page.locator('.cards')).toBeHidden();
    if (testInfo.project.name === 'tablet') {
      // Essential columns only: the label is a secondary one.
      await expect(page.getByRole('columnheader', { name: 'Libellé' })).toBeHidden();
      await expect(page.getByRole('columnheader', { name: 'Ouvert' })).toBeVisible();
    }
    await scope.getByRole('checkbox', { name: /^Sélectionner VTE-000101 / }).check();
    await scope.getByRole('checkbox', { name: /^Sélectionner BQ1-000201 / }).check();
    // The summary and the main button stay on screen (sticky bar).
    const previewButton = page.getByRole('button', { name: 'Aperçu du lettrage' });
    await expect(previewButton).toBeInViewport();
    await expect(page.locator('.selection-bar')).toContainText('2 lignes');
    await previewButton.click();
    const panel = page.getByRole('region', { name: 'Aperçu du lettrage' });
    await expect(panel).toContainText('Lettrage complet');
    await panel.getByRole('button', { name: 'Confirmer le lettrage' }).click();
    await expect(page.getByText('Lettrage LET-000002 créé.')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('due dates and aged balance: tables from the tablet up, cards on a phone', async ({
    page,
    api,
  }, testInfo) => {
    const phone = testInfo.project.name === 'phone';
    for (const url of [
      '/app/comptabilite/echeances',
      '/app/comptabilite/analyse/balance-clients?au=2026-04-15',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(phone ? page.locator('.cards') : page.locator('.wide')).toBeVisible();
      await expect(phone ? page.locator('.wide') : page.locator('.cards')).toBeHidden();
      if (testInfo.project.name === 'tablet' && url.includes('balance')) {
        // Main columns only: the buckets are in the summary, always readable.
        await expect(page.getByRole('columnheader', { name: '1–30 j' })).toBeHidden();
        await expect(page.getByRole('columnheader', { name: 'Solde' })).toBeVisible();
      }
      if (url.includes('balance')) {
        await expect(page.locator('alco-aged-summary')).toContainText('Solde');
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, url).toBeLessThanOrEqual(0);
    }
    // One bucket of a partner: the server's page, as cards on a phone (lot A5.1).
    const other = api.partners.list('A').find((item) => item.code === 'CLI-002')!;
    await page.goto(
      `/app/comptabilite/analyse/balance-clients/${other.public_id}?au=2026-04-15&tranche=not_due`,
    );
    await expect(page.getByRole('status')).toHaveText('Tranche Non échue : 260 échéances');
    await expect(
      (phone ? page.locator('.cards > li') : page.locator('.wide tbody tr')).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.goto('/app/comptabilite/analyse/balance-clients?au=2026-04-15');
    // A partner card leads to its documents, also on a phone.
    await (phone ? page.locator('.cards') : page.locator('.wide'))
      .getByRole('link', { name: /CLI-001/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^CLI-001/);
  });

  test('the records’ smart buttons and the ledger fit every width', async ({ page, api }) => {
    const books = api.accounting.books('A');
    const account = books.accounts.find((item) => item.code === '401')!.public_id;
    const partner = api.partners.list('A').find((item) => item.code === 'FOU-001')!.public_id;
    for (const url of [
      `/app/comptabilite/plan-comptable/${account}`,
      `/app/comptabilite/fournisseurs/${partner}`,
      '/app/comptabilite/analyse/grand-livre?compte=401',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, url).toBeLessThanOrEqual(0);
      const buttons = page.locator('.smart');
      for (const button of await buttons.all()) {
        const box = await button.boundingBox();
        const width = page.viewportSize()?.width ?? 0;
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, url).toBe(true);
      }
    }
  });
});
