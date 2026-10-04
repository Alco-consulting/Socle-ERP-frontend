import { expect, test } from './support/fake-api';

const SCREENS = [
  { name: 'App Launcher', url: '/' },
  { name: 'Tableau de bord', url: '/app/comptabilite/tableau-de-bord' },
  { name: 'Liste', url: '/app/comptabilite/ecritures' },
  { name: 'Nouvelle écriture', url: '/app/comptabilite/ecritures/nouvelle' },
  { name: 'Trésorerie (domaine de Comptabilité)', url: '/app/comptabilite/tresorerie/operations' },
  { name: 'Import d’écritures', url: '/app/comptabilite/ecritures/import' },
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
    await page.goto('/app/comptabilite/ecritures');
    await expect(
      page.getByRole('button', { name: /Société active : ALCO GUINÉE \(test\)/ }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Toutes les applications' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigation Comptabilité' })).toBeVisible();
  });
});
