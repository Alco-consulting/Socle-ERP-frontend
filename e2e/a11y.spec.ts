import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SCREENS = [
  { name: 'App Launcher', url: '/' },
  { name: 'Tableau de bord', url: '/app/comptabilite/tableau-de-bord' },
  { name: 'Liste', url: '/app/comptabilite/ecritures' },
  { name: 'Liste regroupée', url: '/app/comptabilite/ecritures?groupe=journal' },
  { name: 'Formulaire', url: '/app/comptabilite/ecritures/proto-050' },
  { name: 'Écran non construit', url: '/app/comptabilite/journaux' },
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
});
