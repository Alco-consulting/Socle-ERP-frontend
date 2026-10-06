import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { ImportPage } from '../transfers/import-page/import-page';
import { STATEMENT_TRANSFER } from './statement-transfer';

/**
 * Import of bank statements (Module 6) through the generic pipeline: the server reads,
 * checks (duplicates, refused rows, rows to verify), previews and imports; the screen says
 * what it answered and never computes nor corrects anything.
 */
const ALL = [
  'accounting.read',
  'treasury.read',
  'treasury.manage_statements',
  'imports_exports.create',
  'imports_exports.validate',
  'imports_exports.execute',
  'imports_exports.cancel',
];
const FIELDS = [
  { name: 'account', kind: 'code', required: true },
  { name: 'statement_reference', kind: 'text', required: true },
  { name: 'statement_date', kind: 'date', required: true },
  { name: 'period_start', kind: 'date', required: true },
  { name: 'period_end', kind: 'date', required: true },
  { name: 'opening_balance', kind: 'decimal', required: true },
  { name: 'closing_balance', kind: 'decimal', required: true },
  { name: 'line_date', kind: 'date', required: true },
  { name: 'amount', kind: 'decimal', required: true },
  { name: 'external_id', kind: 'text', required: false },
];
/** The file's columns, named like the importer's fields: the mapping suggests them. */
const HEADERS = FIELDS.map((field) => field.name);
const COLUMNS: Record<string, string> = Object.fromEntries(HEADERS.map((name) => [name, name]));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const run = (status: string, extra: object = {}) => ({
  public_id: 'r1',
  import_type: 'treasury.statements',
  status,
  filename: 'releve.csv',
  headers: HEADERS,
  columns: {},
  options: {},
  summary: { total: 4 },
  error: {},
  ...extra,
});
const warning = (line: number, code: string, field: string, details: object = {}) => ({
  line_number: line,
  status: 'warning',
  raw: {},
  messages: [{ level: 'warning', field, code, message: code, details }],
});
const refused = (line: number, code: string, field: string) => ({
  line_number: line,
  status: 'error',
  raw: {},
  messages: [{ level: 'error', field, code, message: code, details: {} }],
});
const page = <T>(results: readonly T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

describe('Trésorerie › Relevés › Import (Module 6)', () => {
  async function open(permissions: readonly string[] = ALL) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'releves/import', component: ImportPage, data: { transfer: STATEMENT_TRANSFER } },
          { path: 'releves', children: [] },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/releves/import');
    httpMock()
      .expectOne('/api/v1/imports-exports/import-types/')
      .flush([
        { import_type: 'partners', fields: [] },
        { import_type: 'treasury.statements', fields: FIELDS },
      ]);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
      await settle();
    };
    const click = async (label: string) => {
      const button = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent?.trim().startsWith(label),
      );
      if (!button) {
        throw new Error(`No button « ${label} »`);
      }
      button.click();
      await stable();
    };
    const post = (path: string) => httpMock().expectOne(`/api/v1/imports-exports/imports/${path}`);
    await stable();
    return { harness, element, stable, click, post };
  }

  /** File chosen, sent, read; then the mapping step. */
  async function toMapping(permissions: readonly string[] = ALL) {
    const view = await open(permissions);
    const input = view.element.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', {
      value: [new File([HEADERS.join(';') + '\n'], 'releve.csv', { type: 'text/csv' })],
    });
    input.dispatchEvent(new Event('change'));
    await view.stable();
    expect(view.element.textContent).toContain('releve.csv');
    await view.click('Envoyer et lire le fichier');
    const create = view.post('');
    expect(create.request.body).toEqual({ import_type: 'treasury.statements' });
    create.flush(run('created'));
    await view.stable();
    view.post('r1/upload/').flush(run('uploaded'));
    await view.stable();
    view.post('r1/parse/').flush(run('parsed'));
    await view.stable();
    return view;
  }

  /** The French way of writing dates and amounts, chosen in the mapping step. */
  async function frenchFormats(element: HTMLElement, stable: () => Promise<void>) {
    const select = (label: string, value: string) => {
      const field = Array.from(element.querySelectorAll('alco-form-field')).find((item) =>
        item.textContent?.includes(label),
      )!;
      const control = field.querySelector<HTMLSelectElement>('select')!;
      control.value = value;
      control.dispatchEvent(new Event('change'));
    };
    select('Format des dates', '%d/%m/%Y');
    select('Séparateur décimal', ',');
    await stable();
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('valid file: columns, formats, checks with rows to verify and duplicates, preview, import', async () => {
    const { element, stable, click, post } = await toMapping();
    // The columns named like the fields' words are suggested.
    expect(element.textContent).toContain('Format des dates');
    await frenchFormats(element, stable);
    await click('Contrôler les lignes');
    const map = post('r1/map/');
    expect(map.request.body).toEqual({
      columns: COLUMNS,
      options: { date_format: '%d/%m/%Y', decimal_separator: ',' },
    });
    map.flush(run('mapped'));
    await stable();
    post('r1/validate/').flush(
      run('validated', { summary: { total: 4, valid: 2, warnings: 2, errors: 0, duplicates: 2 } }),
    );
    await stable();
    const rows = httpMock().expectOne(
      (req) => req.url === '/api/v1/imports-exports/imports/r1/rows/',
    );
    expect(rows.request.params.get('status')).toBe('warning');
    rows.flush(
      page([
        warning(2, 'statement_unbalanced', 'closing_balance', {
          computed: '1950',
          difference: '50',
        }),
        warning(3, 'possible_duplicate', 'amount'),
      ]),
    );
    await stable();
    const verify = element.querySelector('[aria-label="Lignes à vérifier"]')!;
    expect(verify.textContent).toContain('Écart : 50.');
    expect(verify.textContent).toContain('vérifiez qu’il ne s’agit pas d’un doublon');
    expect(element.textContent).toContain('Déjà existantes (ignorées)');
    await click('Voir l’aperçu');
    post('r1/preview/').flush(
      run('previewed', {
        summary: {
          total: 4,
          valid: 2,
          warnings: 2,
          errors: 0,
          duplicates: 2,
          preview: { creations: { statements: 1, lines: 2 }, updates: 0, skipped_duplicates: 1 },
        },
      }),
    );
    await stable();
    expect(element.textContent).toContain('1 relevé');
    expect(element.textContent).toContain('déjà existante');
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    await click('Lancer l’import');
    post('r1/execute/').flush(run('completed', { summary: { created: 1, imported: 2 } }));
    await stable();
    expect(element.textContent).toContain('Import terminé');
    expect(element.textContent).toContain('1 relevé');
  });

  it('refused rows: said by their code, nothing to preview', async () => {
    const { element, stable, click, post } = await toMapping();
    await click('Contrôler les lignes');
    post('r1/map/').flush(run('mapped'));
    await stable();
    post('r1/validate/').flush(
      run('validated', { summary: { total: 3, valid: 1, warnings: 0, errors: 2, duplicates: 0 } }),
    );
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/imports-exports/imports/r1/rows/')
      .flush(
        page([
          refused(2, 'line_already_imported', 'external_id'),
          refused(4, 'duplicate_in_file', 'external_id'),
        ]),
      );
    await stable();
    const report = element.querySelector('[aria-label="Lignes refusées"]')!;
    expect(report.textContent).toContain('Cette transaction est déjà dans un relevé de ce compte.');
    expect(report.textContent).toContain('Cette valeur apparaît plus haut dans le fichier.');
    expect(element.textContent).toContain('rien ne sera importé');
    expect(
      Array.from(element.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Voir l’aperçu'),
      ),
    ).toBe(false);
  });

  it('a file the server cannot read is said by its code', async () => {
    const view = await open();
    const input = view.element.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'releve.csv')] });
    input.dispatchEvent(new Event('change'));
    await view.stable();
    await view.click('Envoyer et lire le fichier');
    view.post('').flush(run('created'));
    await view.stable();
    view.post('r1/upload/').flush(run('uploaded'));
    await view.stable();
    view
      .post('r1/parse/')
      .flush(envelope('imports_parse_failed'), { status: 400, statusText: 'x' });
    await view.stable();
    expect(view.element.textContent).toContain('Le fichier n’a pas pu être lu.');
  });

  it('without imports_exports.validate the checks are not offered', async () => {
    const { element, stable, click, post } = await toMapping(
      ALL.filter((code) => code !== 'imports_exports.validate'),
    );
    await click('Contrôler les lignes');
    post('r1/map/').flush(run('mapped'));
    await stable();
    expect(element.textContent).toContain('Votre profil ne permet pas de contrôler cet import.');
    // Leaving: the unfinished run is cancelled on the server.
  });
});
