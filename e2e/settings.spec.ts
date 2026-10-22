import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, FakeApi, PROFILES, expect, test } from './support/fake-api';

/**
 * Paramètres on the fake API: the company's record (identity, contact details, formats),
 * the platform's users, the members of the company and their rights by application, a
 * member added by their e-mail. Nothing reaches the real API.
 */

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map((violation) => violation.id);
}

/** A company administrator: the company's record and its members, every right of the profile. */
function administrator(api: FakeApi, ...extra: string[]): void {
  api
    .withGlobalPermissions('users.read')
    .withPermissions(COMPANY_A.public_id, [
      ...PROFILES.accountant,
      'companies.read',
      'companies.manage_members',
      ...extra,
    ]);
}

test.describe('Paramètres › Société', () => {
  test('la fiche, comme Odoo : modifiée et enregistrée (seuls les champs changés)', async ({
    page,
    api,
  }) => {
    administrator(api, 'companies.update');
    await page.goto('/app/parametres');
    await expect(page).toHaveURL(/\/app\/parametres\/societe$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ALCO GUINÉE (test)');
    await expect(page.getByLabel('Raison sociale')).toHaveValue('Alco Guinée SARL (test)');
    await expect(page.getByText('Guinée (GN)')).toBeVisible();
    await expect(page.getByText('SYSCOHADA')).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.getByLabel('Ville').fill('Kindia');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Fiche de la société enregistrée.')).toBeVisible();
    const patch = api.calls.find((call) => call.method() === 'PATCH');
    expect(patch?.postDataJSON()).toEqual({ city: 'Kindia' });

    await page.getByLabel('Raison sociale').fill('');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Ce champ est obligatoire.')).toBeVisible();
    await expect(page.getByLabel('Raison sociale')).toBeFocused();
  });

  test('sans companies.update : en lecture seule', async ({ page, api }) => {
    administrator(api);
    await page.goto('/app/parametres/societe');
    await expect(page.getByText('Fiche en lecture seule')).toBeVisible();
    await expect(page.getByLabel('Raison sociale')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0);
  });
});

test.describe('Paramètres › Utilisateurs', () => {
  test('les comptes de la plateforme, leur état', async ({ page, api }) => {
    administrator(api);
    await page.goto('/app/parametres/utilisateurs');
    await expect(page.locator('tbody .person-name')).toHaveText([
      'Mariam Test',
      'Ibrahima Diallo',
      'Fatoumata Camara',
      'Ousmane Bah',
      'Aïssatou Sow',
    ]);
    await expect(page.locator('tbody tr').nth(3)).toContainText('Désactivé');
    expect(await axe(page)).toEqual([]);
  });
});

test.describe('Paramètres › Rôles et droits', () => {
  test('un membre : ses droits par application, cochés puis enregistrés', async ({ page, api }) => {
    administrator(api);
    await page.goto('/app/parametres/roles');
    await expect(page.locator('tbody .person-name')).toHaveText([
      'Mariam Test',
      'Ibrahima Diallo',
      'Fatoumata Camara',
      'Ousmane Bah',
    ]);
    await expect(page.locator('tbody tr').nth(1)).toContainText('Comptable');
    await page.getByRole('link', { name: 'Ibrahima Diallo' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ibrahima Diallo');
    const accounting = page.getByRole('group', { name: 'Comptabilité' });
    await expect(accounting).toContainText('2/13');
    expect(await axe(page)).toEqual([]);

    await accounting.getByLabel('Valider').check();
    await expect(page.getByText('4 droits accordés')).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Droits de Ibrahima Diallo enregistrés.')).toBeVisible();
    const patch = api.calls.find((call) => call.method() === 'PATCH');
    expect(patch?.postDataJSON()).toEqual({
      permissions: [
        'accounting.create',
        'accounting.read',
        'accounting.validate',
        'documents.read',
      ],
    });

    // A right the administrator lacks cannot be granted.
    await expect(
      page.getByRole('group', { name: 'Immobilisations' }).getByLabel('Céder'),
    ).toBeDisabled();
  });

  test('ses propres droits : en lecture seule', async ({ page, api }) => {
    administrator(api);
    await page.goto('/app/parametres/roles');
    await page.getByRole('link', { name: 'Mariam Test' }).click();
    await expect(page.getByText('Ce sont vos propres droits')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0);
  });

  test('ajouter un membre par son adresse : un compte inconnu est dit', async ({ page, api }) => {
    administrator(api);
    await page.goto('/app/parametres/roles');
    await page.getByRole('link', { name: 'Ajouter un membre' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouveau membre');
    await page.getByLabel('Adresse e-mail').fill('inconnu@example.org');
    await page.getByRole('button', { name: 'Ajouter le membre' }).click();
    await expect(page.getByText('Aucun compte actif avec cette adresse.')).toBeVisible();

    await page.getByLabel('Adresse e-mail').fill('aissatou.sow@example.org');
    await page.getByRole('checkbox', { name: 'Documents : tous les droits' }).check();
    await page.getByRole('button', { name: 'Ajouter le membre' }).click();
    await expect(page.getByText('Aïssatou Sow est maintenant membre de la société.')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/parametres\/roles\/m-[\w-]+$/);
    const post = api.calls
      .filter((call) => call.method() === 'POST' && call.url().includes('memberships'))
      .at(-1);
    expect(post?.postDataJSON()).toEqual({
      email: 'aissatou.sow@example.org',
      permissions: ['documents.download', 'documents.read', 'documents.upload'],
    });
  });
});
