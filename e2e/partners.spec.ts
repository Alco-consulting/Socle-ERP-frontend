import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

import { COMPANY_A, COMPANY_B, PROFILES, expect, test } from './support/fake-api';

/**
 * Tiers on the (fake) API: list, search, filters, record, creation, modification,
 * permissions, company switch, import and export. Nothing reaches the real API.
 */

const codes = (page: Page) => page.locator('tbody a.code');
const companyButton = (page: Page) => page.getByRole('button', { name: /^Société active/ });

async function axe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map((violation) => violation.id);
}

test.describe('Tiers — liste, recherche, filtres', () => {
  test('Scénario 1 : lanceur → Tiers → la liste de la société', async ({ page, api }) => {
    await page.goto('/app');
    await page.getByRole('link', { name: /Tiers/ }).click();
    await expect(page).toHaveURL(/\/app\/tiers\/liste$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tous les tiers');
    await expect(codes(page)).toHaveText([
      'CLI-001',
      'CLI-002',
      'CLI-003',
      'FOU-001',
      'FOU-002',
      'MIX-001',
      'OTH-001',
    ]);
    await expect(page.getByRole('row', { name: /CLI-003/ })).toContainText('Inactif');
    const [list] = api.callsTo('partners/');
    expect(await list.headerValue('x-company-id')).toBe(COMPANY_A.public_id);
    expect(new URL(list.url()).searchParams.get('page_size')).toBe('20');
    await expect(page.getByRole('note', { name: 'Démonstration' })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });

  test('Scénario 2 : recherche côté serveur, reflétée dans l’URL', async ({ page, api }) => {
    await page.goto('/app/tiers/liste');
    await expect(codes(page)).toHaveCount(7);
    await page.getByRole('searchbox', { name: 'Rechercher un tiers' }).fill('diallo');
    await expect(page).toHaveURL(/q=diallo/);
    await expect(codes(page)).toHaveText(['FOU-001']);
    const last = api.callsTo('partners/').at(-1)!;
    expect(new URL(last.url()).searchParams.get('search')).toBe('diallo');

    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Rechercher un tiers' })).toHaveValue(
      'diallo',
    );
    await expect(codes(page)).toHaveText(['FOU-001']);
  });

  test('Scénario 3 : filtres État et Rôle, en langage utilisateur', async ({ page, api }) => {
    await page.goto('/app/tiers/liste');
    await page.getByRole('button', { name: 'Filtres' }).click();
    const panel = page.getByRole('dialog', { name: 'Filtres' });
    await panel.getByLabel('État').selectOption({ label: 'Actif' });
    await panel.getByLabel('Rôle').selectOption({ label: 'Fournisseurs' });
    await panel.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page).toHaveURL(/etat=active/);
    await expect(page).toHaveURL(/role=supplier/);
    await expect(codes(page)).toHaveText(['FOU-001', 'FOU-002', 'MIX-001']);
    const params = new URL(api.callsTo('partners/').at(-1)!.url()).searchParams;
    expect(params.get('status')).toBe('active');
    expect(params.get('role')).toBe('supplier');

    await page.getByRole('button', { name: 'Retirer le critère Rôle : Fournisseurs' }).click();
    await expect(page).not.toHaveURL(/role=/);

    await page.goto('/app/tiers/clients');
    await expect(codes(page)).toHaveText(['CLI-001', 'CLI-002', 'CLI-003', 'MIX-001']);
  });

  test('aucun résultat : expliqué, avec la réinitialisation', async ({ page }) => {
    await page.goto('/app/tiers/liste?q=introuvable');
    await expect(page.getByText('Aucun tiers ne correspond à ces critères.')).toBeVisible();
    await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
    await expect(codes(page)).toHaveCount(7);
  });
});

test.describe('Tiers — fiche, création, modification', () => {
  test('Scénarios 4 et 5 : créer un tiers, puis sa fiche', async ({ page, api }) => {
    await page.goto('/app/tiers/liste');
    await page.getByRole('link', { name: 'Nouveau tiers' }).click();
    await expect(page).toHaveURL(/\/app\/tiers\/nouveau$/);
    await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toBeFocused();

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(
      page.getByText('Certaines informations sont manquantes ou incorrectes.'),
    ).toBeVisible();
    expect(api.callsTo('partners/').filter((call) => call.method() === 'POST')).toHaveLength(0);

    await page.getByRole('textbox', { name: 'Code', exact: true }).fill('cli-010');
    await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Kaba Distribution');
    await page.getByRole('checkbox', { name: 'Client', exact: true }).check();
    await page.getByLabel('Pays').fill('GN');
    await page.getByLabel('Téléphone').fill('+224 620 00 00 00');
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText('Tiers « Kaba Distribution » créé.')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/tiers\/liste\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kaba Distribution');
    await expect(page.getByText('CLI-010 · Client')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' })).toContainText(
      'CLI-010 — Kaba Distribution',
    );
    const [create] = api.callsTo('partners/').filter((call) => call.method() === 'POST');
    // Only the writable fields of the API: no identifier, no status, no company.
    expect(Object.keys(create.postDataJSON() as object)).not.toEqual(
      expect.arrayContaining(['public_id', 'status', 'company']),
    );

    await page
      .getByRole('navigation', { name: 'Fil d’Ariane' })
      .getByRole('link', { name: 'Tous les tiers' })
      .click();
    await expect(codes(page)).toContainText(['CLI-010']);
    await page.getByRole('link', { name: 'CLI-010' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kaba Distribution');
    expect(await axe(page)).toEqual([]);
  });

  test('un code déjà utilisé : l’erreur du serveur sous le champ', async ({ page }) => {
    await page.goto('/app/tiers/nouveau');
    await page.getByRole('textbox', { name: 'Code', exact: true }).fill('CLI-001');
    await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Doublon');
    await page.getByLabel('Pays').fill('GN');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(
      page.getByText('Ce code est déjà utilisé par un autre tiers de la société.'),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toBeFocused();
  });

  test('Scénario 6 : modifier — seuls les champs changés, jamais le code', async ({
    page,
    api,
  }) => {
    await page.goto('/app/tiers/liste');
    await page.getByRole('link', { name: 'FOU-001' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Diallo et Cie');
    await page.getByRole('link', { name: 'Modifier' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Modifier Diallo et Cie');
    await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toHaveCount(0);
    await page.getByLabel('Téléphone').fill('+224 655 44 33 22');
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Diallo et Cie');
    await expect(page.getByText('+224 655 44 33 22')).toBeVisible();
    const patch = api.calls.find((call) => call.method() === 'PATCH')!;
    expect(patch.postDataJSON()).toEqual({ phone: '+224 655 44 33 22' });
  });

  test('désactiver puis réactiver, après confirmation', async ({ page, api }) => {
    await page.goto('/app/tiers/liste');
    await page.getByRole('link', { name: 'CLI-002' }).click();
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Désactiver' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Désactiver' }).click();
    await expect(page.getByText('Tiers désactivé.')).toBeVisible();
    await expect(page.getByText('Ce tiers est désactivé', { exact: false })).toBeVisible();
    expect(api.calls.some((call) => call.url().endsWith('/deactivate/'))).toBe(true);
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Réactiver' })).toBeVisible();
  });
});

test.describe('Tiers — permissions et sécurité (le serveur reste l’autorité)', () => {
  test('Scénario 7 : sans permission, ni tuile, ni accès direct', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, PROFILES.viewer); // no partners.read
    await page.goto('/app');
    await expect(page.locator('.tile-label')).not.toContainText(['Tiers']);
    await page.goto('/app/tiers/liste');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByText('Vous n’avez pas accès à l’application Tiers dans cette société.'),
    ).toBeVisible();
    expect(api.callsTo('partners/')).toHaveLength(0);
  });

  test('lecture seule : ni création, ni modification, ni import/export', async ({ page, api }) => {
    api.withPermissions(COMPANY_A.public_id, ['partners.read']);
    await page.goto('/app/tiers/liste');
    await expect(codes(page)).toHaveCount(7);
    await expect(page.getByRole('link', { name: 'Nouveau tiers' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Actions' })).toHaveCount(0);
    await page.getByRole('link', { name: 'CLI-001' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dupont SARL');
    await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0);

    await page.goto('/app/tiers/nouveau');
    await expect(page.getByText('Votre profil ne permet pas d’ouvrir cet écran.')).toBeVisible();
  });

  test('le tiers d’une autre société (IDOR) : « n’existe pas ou plus »', async ({ page, api }) => {
    const other = api.partners.list('B')[0];
    await page.goto(`/app/tiers/liste/${other.public_id}`);
    await expect(page.getByText('Ce tiers n’existe pas ou plus dans cette société.')).toBeVisible();
    await expect(page.getByText(other.name)).toHaveCount(0);
  });

  test('Scénario 8 : changer de société — aucun tiers de l’ancienne ne reste', async ({
    page,
    api,
  }) => {
    await page.goto('/app/tiers/liste');
    await expect(codes(page)).toHaveCount(7);
    await companyButton(page).click();
    await page.getByRole('menuitemradio', { name: /FILIALE SÉNÉGAL/ }).click();
    await expect(page).toHaveURL(/\/app\/tiers\/liste$/);
    await expect(codes(page)).toHaveText(['SN-CLI-01', 'SN-FOU-01']);
    await expect(page.getByText('Dupont SARL')).toHaveCount(0);
    const last = api.callsTo('partners/').at(-1)!;
    expect(await last.headerValue('x-company-id')).toBe(COMPANY_B.public_id);
  });
});

test.describe('Tiers — import et export contextuels', () => {
  test('Scénario 9a : exporter les tiers selon les filtres, fichier téléchargé', async ({
    page,
    api,
  }) => {
    await page.goto('/app/tiers/liste?etat=active');
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Importer des tiers',
      'Exporter les tiers',
    ]);
    await page.getByRole('menuitem', { name: 'Exporter les tiers' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Exporter les tiers ?' });
    await expect(dialog).toContainText('tous les tiers actifs');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Exporter les tiers' }).click();
    expect((await download).suggestedFilename()).toBe('tiers.csv');
    await expect(page.getByText('Export prêt : 6 lignes.')).toBeVisible();
    const [create] = api.callsTo('imports-exports/exports/');
    expect(create.postDataJSON()).toEqual({
      export_type: 'partners',
      parameters: { status: 'active' },
      asynchronous: false,
    });
  });

  test('Scénario 9b : importer des tiers, étape par étape', async ({ page, api }) => {
    await page.goto('/app/tiers/liste');
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Importer des tiers' }).click();
    await expect(page).toHaveURL(/\/app\/tiers\/liste\/import$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import de tiers');

    await page.locator('input[type=file]').setInputFiles({
      name: 'nouveaux-tiers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Code,Nom,Pays,Client\nIMP-001,Import Un,GN,oui\nIMP-002,Import Deux,GN,non\n',
      ),
    });
    await page.getByRole('button', { name: 'Envoyer et lire le fichier' }).click();
    await expect(page.getByText('Séparateur détecté')).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('2 lignes lues dans nouveaux-tiers.csv')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Code', exact: true })).toHaveValue('Code');
    await page.getByRole('combobox', { name: 'Client (oui/non)' }).selectOption('Client');
    await page.getByRole('button', { name: 'Contrôler les lignes' }).click();
    await expect(page.getByText('Lignes correctes', { exact: false })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: 'Voir l’aperçu' }).click();
    await expect(page.getByText('2 tiers seront créés', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Lancer l’import' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lancer l’import' }).click();
    await expect(page.getByText('Import terminé', { exact: true })).toBeVisible();
    await expect(page.getByText('2 tiers importés')).toBeVisible();
    const map = api.calls.find((call) => call.url().endsWith('/map/'))!;
    expect(map.postDataJSON()).toEqual({
      columns: { code: 'Code', name: 'Nom', country: 'Pays', is_customer: 'Client' },
      // How dates and amounts are written: the server's defaults unless changed.
      options: { date_format: '%Y-%m-%d', decimal_separator: '.' },
    });

    await page.getByRole('link', { name: 'Retour aux tiers' }).click();
    await expect(codes(page)).toContainText(['IMP-001', 'IMP-002']);
  });
});

test.describe('Tiers — téléphone et accessibilité', () => {
  const overflow = (page: Page) =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

  test('téléphone : menu du module, tableau dans son cadre, formulaire sur une colonne', async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/tiers/liste');
    await expect(codes(page)).toHaveCount(7);
    await expect(page.getByRole('button', { name: /^Navigation Tiers :/ })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.goto('/app/tiers/nouveau');
    const code = page.getByRole('textbox', { name: 'Code', exact: true });
    const name = page.getByRole('textbox', { name: 'Nom', exact: true });
    await expect(code).toBeVisible();
    const [first, second] = [await code.boundingBox(), await name.boundingBox()];
    expect(first?.x).toBe(second?.x); // one column
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await axe(page)).toEqual([]);

    await page.goto(`/app/tiers/liste/${api.partners.list('A')[0].public_id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dupont SARL');
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.goto('/app/tiers/liste/import');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import de tiers');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await axe(page)).toEqual([]);
  });
});
