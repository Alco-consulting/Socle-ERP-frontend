import { Page } from '@playwright/test';

/** The horizontal navigation of Comptabilité (wide screens). */
export const moduleNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Navigation Comptabilité' });

/** Opens « Comptabilité ▾ », « Analyse ▾ » or « Configuration ▾ » and chooses a screen. */
export async function openMenuItem(page: Page, menu: string, label: string): Promise<void> {
  await moduleNav(page).getByRole('button', { name: menu, exact: true }).click();
  await page
    .getByRole('menu')
    .getByRole('menuitemradio', { name: label, exact: true })
    .first()
    .click();
}

/**
 * The day the e2e run in (an open fiscal year of the fake API holds it): stable balances.
 * Time then flows from it, so that the searches waiting for a pause in typing answer.
 */
export async function fixToday(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-10-04T10:00:00') });
  await page.clock.resume();
}
