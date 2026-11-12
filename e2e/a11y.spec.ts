import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/fake-api';

const SCREENS = [
  { name: 'App Launcher', url: '/' },
  { name: 'Tableau de bord', url: '/app/comptabilite/tableau-de-bord' },
  { name: 'Écritures comptables', url: '/app/comptabilite/ecritures' },
  { name: 'Liste', url: '/app/comptabilite/ecritures/pieces' },
  { name: 'Lettrage', url: '/app/comptabilite/lettrage' },
  { name: 'Échéances', url: '/app/comptabilite/echeances' },
  { name: 'Balance âgée', url: '/app/comptabilite/analyse/balance-clients?au=2026-04-15' },
  { name: 'Clients (liste de Comptabilité)', url: '/app/comptabilite/clients' },
  { name: 'Analyse › Balance comptable', url: '/app/comptabilite/analyse/balance' },
  { name: 'Analyse › Compte de résultat', url: '/app/comptabilite/analyse/resultat' },
  { name: 'Analyse › Bilan', url: '/app/comptabilite/analyse/bilan' },
  { name: 'Liste regroupée', url: '/app/comptabilite/plan-comptable?groupe=classe' },
  { name: 'Formulaire', url: '/app/comptabilite/ecritures/nouvelle' },
  { name: 'Écran non construit', url: '/app/comptabilite/immobilisations/actifs' },
  { name: 'Trésorerie (navigation de domaine)', url: '/app/comptabilite/tresorerie/operations' },
  { name: 'Import d’écritures', url: '/app/comptabilite/ecritures/import' },
  { name: 'Contacts', url: '/app/contacts/liste' },
  { name: 'Catalogue', url: '/design-system' },
];

test.describe('Accessibilité (axe-core, WCAG 2.1 A/AA)', () => {
  // Both themes: the dark one is the device's choice or the top bar's switch (styles/_tokens.scss).
  for (const [scheme, suffix] of [
    ['light', ''],
    ['dark', ' (sombre)'],
  ] as const) {
    for (const screen of SCREENS) {
      test(`${screen.name}${suffix}: no accessibility violation`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
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
  }

  test('le bouton de thème bascule clair / sombre (icône de l’action) et reste après un rechargement', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    // The theme is no longer in the account menu.
    await page.getByRole('button', { name: /^Compte de / }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Sombre' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    const toDark = page.getByRole('button', { name: 'Passer en mode sombre' });
    await expect(toDark).toHaveAttribute('title', 'Mode sombre');
    await toDark.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const toLight = page.getByRole('button', { name: 'Passer en mode clair' });
    await expect(toLight).toHaveAttribute('title', 'Mode clair');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await toLight.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('au clavier, le bouton de thème bascule aussi', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Passer en mode sombre' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Passer en mode clair' })).toBeFocused();
  });

  test('le thème enregistré s’applique avant Angular : pas de flash', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => localStorage.setItem('alco.theme', 'dark'));
    // Angular never starts: only public/theme-init.js can set the theme.
    await page.route(/\/(main|polyfills)[^/]*\.js(\?.*)?$/, (route) => route.abort());
    await page.goto('/app/comptabilite/tableau-de-bord');
    await expect(page.locator('alco-root')).toBeEmpty(); // Angular did not start
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(13, 21, 32)'); // --night-950, the dark page
  });

  test('le logo du thème affiché : clair, puis sombre', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const brand = page.getByRole('link', { name: /^Toutes les applications/ });
    await expect(brand.locator('img.logo-light')).toBeVisible();
    await expect(brand.locator('img.logo-dark')).toBeHidden();
    await page.getByRole('button', { name: 'Passer en mode sombre' }).click();
    await expect(brand.locator('img.logo-dark')).toBeVisible();
    await expect(brand.locator('img.logo-light')).toBeHidden();
    // As the device, in the dark: the dark logo too.
    await page.evaluate(() => localStorage.removeItem('alco.theme'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    await expect(brand.locator('img.logo-dark')).toBeVisible();
  });

  test('open menus and the filter panel stay accessible', async ({ page }) => {
    await page.goto('/app/comptabilite/ecritures/pieces');
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
    await expect(menu.getByRole('menuitemradio', { name: 'Balance comptable' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/comptabilite\/analyse\/balance$/);
  });
});
