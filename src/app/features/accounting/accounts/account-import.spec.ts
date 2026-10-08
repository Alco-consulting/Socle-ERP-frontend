import { TestBed } from '@angular/core/testing';
import { Route, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom } from 'rxjs';

import { APP_CONFIG } from '../../../core/config/app-config';
import { REQUEST_TIMEOUT } from '../../../core/http/http-context';
import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { ImportPage } from '../../transfers/import-page/import-page';
import { rowMessage } from '../../transfers/transfer-messages';
import { TransfersApi } from '../../transfers/transfers-api';
import { ACCOUNTING_ROUTES } from '../accounting.routes';
import { AccountListPage } from './account-list';
import { ACCOUNT_TRANSFER } from './account-transfer';

const IMPORT = [
  'accounting.read',
  'accounting.manage_accounts',
  'imports_exports.create',
  'imports_exports.validate',
  'imports_exports.execute',
  'imports_exports.cancel',
];
const FIELDS = [
  { name: 'code', kind: 'code', required: true },
  { name: 'name', kind: 'text', required: true },
  { name: 'account_type', kind: 'text', required: true },
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const emptyPage = { count: 0, next: null, previous: null, results: [] };

/** Only for the tests that configure TestBed (the others must not instantiate it). */
function cleanUp(): void {
  httpMock().verify();
  clearCookie('XSRF-TOKEN');
  document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
}

describe('Import du plan comptable (accounting.accounts)', () => {
  it('describes the API type: three fields, flat — no parent, no export', () => {
    expect(ACCOUNT_TRANSFER.importType).toBe('accounting.accounts');
    expect(ACCOUNT_TRANSFER.exportType).toBeNull();
    expect(ACCOUNT_TRANSFER.importPermission).toBe('accounting.manage_accounts');
    expect(ACCOUNT_TRANSFER.creationKey).toBe('accounts');
    expect(Object.keys(ACCOUNT_TRANSFER.fieldLabels)).toEqual(['code', 'name', 'account_type']);
    expect(ACCOUNT_TRANSFER.countLabel(1)).toBe('1 compte');
    expect(ACCOUNT_TRANSFER.countLabel(1245)).toBe('1245 comptes');
  });

  it('route plan-comptable/import: the generic screen, guarded, before the record', () => {
    const chart = ACCOUNTING_ROUTES.find((route) => route.path === 'plan-comptable') as Route;
    const paths = (chart.children ?? []).map((route) => route.path);
    expect(paths.indexOf('import')).toBeGreaterThan(-1);
    expect(paths.indexOf('import')).toBeLessThan(paths.indexOf(':id'));
    const route = chart.children?.find((item) => item.path === 'import') as Route;
    expect(route.data).toEqual({
      breadcrumb: 'Import du plan comptable',
      transfer: ACCOUNT_TRANSFER,
    });
    expect(route.canActivate).toHaveLength(1);
  });

  describe('Plan comptable › Actions', () => {
    afterEach(cleanUp);

    async function list(permissions: string[]) {
      TestBed.configureTestingModule({
        providers: [
          ...provideHttpTesting(),
          provideRouter([{ path: 'plan-comptable', component: AccountListPage }]),
        ],
      });
      openTestSession(TestBed.inject(SessionStore), { permissions });
      setCookie('XSRF-TOKEN', 'tok');
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/plan-comptable');
      httpMock()
        .expectOne((req) => req.url === '/api/v1/accounting/accounts/')
        .flush(emptyPage);
      await settle();
      await harness.fixture.whenStable();
      const element = harness.routeNativeElement as HTMLElement;
      const actions = () =>
        Array.from(element.querySelectorAll('button')).find(
          (button) => button.textContent?.trim() === 'Actions',
        );
      const links = () =>
        Array.from(element.querySelectorAll('a')).map((link) => link.textContent?.trim());
      return { harness, actions, links };
    }

    it('« Importer des comptes » with both permissions, also from the empty chart', async () => {
      const { harness, actions, links } = await list(IMPORT);
      expect(links()).toContain('Importer des comptes');
      actions()?.click();
      await harness.fixture.whenStable();
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'));
      expect(items.map((item) => item.textContent?.trim())).toEqual(['Importer des comptes']);
    });

    it('no import without imports_exports.create or without accounting.manage_accounts', async () => {
      const creator = await list(['accounting.read', 'accounting.manage_accounts']);
      expect(creator.actions()).toBeUndefined();
      expect(creator.links()).not.toContain('Importer des comptes');
      expect(creator.links()).toContain('Créer un compte');
      TestBed.resetTestingModule();

      const importer = await list(['accounting.read', 'imports_exports.create']);
      expect(importer.actions()).toBeUndefined();
      expect(importer.links()).not.toContain('Importer des comptes');
    });
  });

  describe('the generic import screen with this type', () => {
    afterEach(cleanUp);

    async function open(types: unknown[]) {
      TestBed.configureTestingModule({
        providers: [
          ...provideHttpTesting(),
          provideRouter([
            {
              path: 'plan-comptable/import',
              component: ImportPage,
              data: { transfer: ACCOUNT_TRANSFER },
            },
          ]),
        ],
      });
      openTestSession(TestBed.inject(SessionStore), { permissions: IMPORT });
      setCookie('XSRF-TOKEN', 'tok');
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/plan-comptable/import');
      httpMock().expectOne('/api/v1/imports-exports/import-types/').flush(types);
      await settle();
      await harness.fixture.whenStable();
      return { harness, element: harness.routeNativeElement as HTMLElement };
    }

    it('the server’s three fields, in the user’s words; Code, Nom du compte, Type suggested', async () => {
      const { harness, element } = await open([
        { import_type: 'accounting.accounts', fields: FIELDS },
      ]);
      expect(
        Array.from(element.querySelectorAll('.columns tbody td:first-child')).map((cell) =>
          cell.textContent?.trim(),
        ),
      ).toEqual(['Code', 'Nom du compte', 'Type']);

      const input = element.querySelector<HTMLInputElement>('input[type=file]')!;
      const file = new File(['Code;Nom du compte;Type\n'], 'plan.csv', { type: 'text/csv' });
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change'));
      await harness.fixture.whenStable();
      Array.from(element.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Envoyer et lire le fichier'))
        ?.click();
      const run = {
        public_id: 'r1',
        import_type: 'accounting.accounts',
        filename: 'plan.csv',
        headers: ['Code', 'Nom du compte', 'Type'],
        columns: {},
        options: {},
        summary: { total: 1245 },
        error: {},
      };
      await settle();
      httpMock()
        .expectOne('/api/v1/imports-exports/imports/')
        .flush({ ...run, status: 'created' });
      await settle();
      httpMock()
        .expectOne('/api/v1/imports-exports/imports/r1/upload/')
        .flush({ ...run, status: 'uploaded' });
      await settle();
      httpMock()
        .expectOne('/api/v1/imports-exports/imports/r1/parse/')
        .flush({ ...run, status: 'parsed', options: { encoding: 'utf-8-sig', delimiter: ';' } });
      await settle();
      await harness.fixture.whenStable();
      expect(element.textContent).toContain('Encodage détecté');
      expect(element.textContent).toContain('UTF-8 avec BOM (Excel)');
      Array.from(element.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Continuer')
        ?.click();
      await settle();
      await harness.fixture.whenStable();

      const selects = Array.from(element.querySelectorAll<HTMLSelectElement>('.mapping select'));
      expect(selects.map((select) => select.value)).toEqual(['Code', 'Nom du compte', 'Type']);
      // Neither dates nor amounts are read: no format is asked.
      expect(element.textContent).not.toContain('Format des dates');
      expect(element.textContent).not.toContain('Séparateur décimal');
      expect(element.textContent).not.toContain('Parent');
      // Leaving: the unfinished run is cancelled.
      harness.fixture.destroy();
      httpMock().expectOne('/api/v1/imports-exports/imports/r1/cancel/').flush({});
    });

    it('an import the server does not offer: said, no file can be sent', async () => {
      const { element } = await open([{ import_type: 'partners', fields: [] }]);
      expect(element.textContent).toContain('Cet import n’est pas disponible.');
      const send = Array.from(element.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Envoyer et lire le fichier'),
      );
      expect(send?.disabled).toBe(true);
    });
  });

  it('a refused type is said with the value read, never guessed', () => {
    expect(
      rowMessage({
        level: 'error',
        field: 'account_type',
        code: 'unknown_account_type',
        message: 'This account type is not one of the known labels.',
        details: { value: 'Capitaux Propres' },
      }),
    ).toBe(
      'Type inconnu : seuls les libellés validés du plan sont acceptés. Valeur lue : « Capitaux Propres ».',
    );
  });

  describe('TransfersApi', () => {
    afterEach(cleanUp);

    it('checking and importing a large file wait longer than a read', () => {
      TestBed.configureTestingModule({ providers: provideHttpTesting() });
      openTestSession(TestBed.inject(SessionStore));
      setCookie('XSRF-TOKEN', 'tok');
      const api = TestBed.inject(TransfersApi);
      const long = TestBed.inject(APP_CONFIG).uploadTimeoutMs;
      for (const [call, path, timeout] of [
        [() => api.validate('r1'), 'validate', long],
        [() => api.execute('r1'), 'execute', long],
        [() => api.preview('r1'), 'preview', null],
      ] as const) {
        void firstValueFrom(call());
        const request = httpMock().expectOne(`/api/v1/imports-exports/imports/r1/${path}/`);
        expect(request.request.context.get(REQUEST_TIMEOUT)).toBe(timeout);
        request.flush({});
      }
    });
  });
});
