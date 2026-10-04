import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/fake-api';

const SCREENS = [
  { name: 'App Launcher', url: '/' },
  { name: 'Tableau de bord', url: '/app/comptabilite/tableau-de-bord' },
  { name: 'Liste', url: '/app/comptabilite/ecritures' },
  { name: 'Lettrage', url: '/app/comptabilite/lettrage' },
  { name: 'Échéances', url: '/app/comptabilite/echeances' },
  { name: 'Balance âgée', url: '/app/comptabilite/analyse/balance-clients?au=2026-04-15' },
  { name: 'Clients (liste de Comptabilité)', url: '/app/comptabilite/clients' },
  { name: 'Analyse › Balance générale', url: '/app/comptabilite/analyse/balance' },
  { name: 'Liste regroupée', url: '/app/comptabilite/plan-comptable?groupe=classe' },
  { name: 'Formulaire', url: '/app/comptabilite/ecritures/nouvelle' },
  { name: 'Écran non construit', url: '/app/comptabilite/immobilisations/actifs' },
  { name: 'Trésorerie (navigation de domaine)', url: '/app/comptabilite/tresorerie/operations' },
  { name: 'Import d’écritures', url: '/app/comptabilite/ecritures/import' },
  { name: 'Tiers', url: '/app/tiers/liste' },
  { name: 'Catalogue', url: '/design-system' },
];

test.describe('Accessibilité (axe-core, WCAG 2.1 A/AA)', () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: no accessibility violation`, async ({ page }) => {
      await page.goto(screen.url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const violations = results.violations.map(
        (violation) =>
          `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      );
      expect(violations).toEqual([]);
    });
  }

  test('open menus and the filter panel stay accessible', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures');
    await page.getByRole('button', { name: 'Filtres' }).click();
    await expect(page.getByRole('dialog', { name: 'Filtres' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test('the grouped menus: titles announced, keyboard only, no violation', async ({ page }) => {
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navigation Comptabilité' });
    await nav.getByRole('button', { name: 'Analyse', exact: true }).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    // Each group is named by its visible title.
    await expect(menu.getByRole('group', { name: 'Rapports comptables' })).toBeVisible();
    await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    // Arrows move through the groups; Enter opens the screen.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Balance générale' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/balance$/);
  });
});
