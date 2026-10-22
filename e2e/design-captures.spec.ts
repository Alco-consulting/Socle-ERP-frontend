import { Page } from '@playwright/test';

import { COMPANY_A, PROFILES, expect, test } from './support/fake-api';

/**
 * Screenshots of the main screens for the design audit (docs/design): on demand only,
 * `npx playwright test --project=captures e2e/design-captures.spec.ts`. Fake API, no data
 * of a real company. `CAPTURES` names the folder (`apres` by default; `avant` is kept).
 */
const OUT = `../docs/design/${process.env['CAPTURES'] ?? 'apres'}`;

test.describe.configure({ mode: 'serial' });

const SCREENS: readonly (readonly [string, string])[] = [
  ['01-accueil', '/app'],
  ['02-tableau-de-bord', '/app/comptabilite/tableau-de-bord'],
  ['03-ecritures', '/app/comptabilite/ecritures'],
  ['04-pieces', '/app/comptabilite/ecritures/pieces'],
  ['06-contacts', '/app/contacts/liste'],
  ['07-contact-nouveau', '/app/contacts/nouveau'],
  ['08-documents', '/app/documents/liste'],
  ['09-parametres-societe', '/app/parametres/societe'],
  ['10-reconciliation', '/app/comptabilite/tresorerie/transactions'],
  ['11-factures', '/app/comptabilite/ventes/factures'],
  ['12-facture-nouvelle', '/app/comptabilite/ventes/factures/nouvelle'],
  ['13-plan-comptable', '/app/comptabilite/plan-comptable'],
  ['14-parametres-utilisateurs', '/app/parametres/utilisateurs'],
  ['15-parametres-roles', '/app/parametres/roles'],
  [
    '16-parametres-membre',
    `/app/parametres/roles/m-${COMPANY_A.public_id}-eeeeeeee-0000-4000-8000-000000000011`,
  ],
];

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

/** A navigation interrupted by the application's own (a redirect) is tried again once. */
async function visit(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url);
  } catch {
    await page.waitForTimeout(500);
    await page.goto(url);
  }
}

async function newEntry(page: Page): Promise<void> {
  await visit(page, '/app/comptabilite/ecritures/pieces');
  await page
    .getByRole('link', { name: /Nouvelle|Nouveau/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Light on a desktop, dark on a desktop, light on a phone (the charte asks for the three). */
for (const [suffix, width, height, colorScheme] of [
  ['bureau', 1440, 900, 'light'],
  ['sombre', 1440, 900, 'dark'],
  ['mobile', 390, 844, 'light'],
] as const) {
  test(`${suffix} ${width} × ${height}`, async ({ page, api }) => {
    test.setTimeout(300_000); // a dozen screens, each settled before its picture
    // A company administrator, so that Paramètres show too.
    api
      .withGlobalPermissions('users.read', 'companies.read')
      .withPermissions(COMPANY_A.public_id, [
        ...PROFILES.accountant,
        'companies.read',
        'companies.update',
        'companies.manage_members',
      ]);
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height });
    for (const [name, url] of SCREENS) {
      await visit(page, url);
      await shoot(page, `${name}-${suffix}`, width > 1000);
    }
    await newEntry(page);
    await shoot(page, `05-ecriture-saisie-${suffix}`, width > 1000);
    // The global search, opened by its shortcut, a few letters typed.
    await page.keyboard.press('Control+K');
    await page.getByRole('combobox', { name: /Rechercher un écran/ }).fill('bal');
    await shoot(page, `17-recherche-${suffix}`);
  });
}
