import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PARTNER_TRANSFER } from '../../partners/partner-presentation';
import { WORKBOOK_CONTENT_TYPE } from '../transfers-api';
import { ImportPage } from './import-page';

const ALL = [
  'partners.read',
  'partners.create',
  'imports_exports.create',
  'imports_exports.validate',
  'imports_exports.execute',
  'imports_exports.cancel',
];
const FIELDS = [
  { name: 'code', kind: 'code', required: true },
  { name: 'name', kind: 'text', required: true },
  { name: 'country', kind: 'code', required: true },
  { name: 'email', kind: 'text', required: false },
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const run = (status: string, extra: object = {}) => ({
  public_id: 'r1',
  import_type: 'partners',
  status,
  filename: 'tiers.csv',
  headers: ['Code', 'Nom', 'Pays', 'Email'],
  columns: {},
  options: {},
  summary: { total: 2 },
  error: {},
  ...extra,
});

describe('ImportPage (contextual import on the API)', () => {
  async function open(permissions = ALL) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'tiers/import', component: ImportPage, data: { transfer: PARTNER_TRANSFER } },
          { path: 'tiers', children: [] },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/tiers/import');
    httpMock()
      .expectOne('/api/v1/imports-exports/import-types/')
      .flush([
        { import_type: 'accounting.entries', fields: [] },
        { import_type: 'partners', fields: FIELDS },
      ]);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
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

  async function chooseFile(element: HTMLElement, stable: () => Promise<void>) {
    const input = element.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File(['Code,Nom,Pays\n'], 'tiers.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await stable();
  }

  /** The first rows the screen asks once the file is read (the `rows/` endpoint). */
  function firstRows(rows: readonly { line: number; raw: Record<string, string> }[] = []) {
    const request = httpMock().expectOne(
      (req) => req.url === '/api/v1/imports-exports/imports/r1/rows/',
    );
    expect(request.request.params.get('page_size')).toBe('5');
    expect(request.request.params.has('status')).toBe(false);
    request.flush({
      count: rows.length,
      next: null,
      previous: null,
      results: rows.map((row) => ({
        line_number: row.line,
        status: 'pending',
        raw: row.raw,
        messages: [],
      })),
    });
  }

  /** An error envelope with its details (`envelope` has none). */
  function refusal(code: string, details: object) {
    return { error: { code, message: 'x', details, correlation_id: 'c' } };
  }

  /** Up to the mapping step, with the columns the server read. */
  async function toMapping() {
    const page = await open();
    await chooseFile(page.element, page.stable);
    await page.click('Envoyer et lire le fichier');
    const create = page.post('');
    expect(create.request.body).toEqual({ import_type: 'partners' });
    create.flush(run('created'));
    await page.stable();
    page.post('r1/upload/').flush(run('uploaded'));
    await page.stable();
    const parse = page.post('r1/parse/');
    // Nothing technical is chosen: the server reads the encoding and the delimiter.
    expect(parse.request.body).toEqual({});
    parse.flush(run('parsed', { options: { encoding: 'utf-8-sig', delimiter: ';' } }));
    await page.stable();
    firstRows();
    await page.stable();
    await page.click('Continuer vers la correspondance des colonnes');
    return page;
  }

  /** The file chosen (not sent yet). */
  async function withFile(name = 'tiers.csv') {
    const page = await open();
    const input = page.element.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], name)] });
    input.dispatchEvent(new Event('change'));
    await page.stable();
    return page;
  }

  /** Sent: created and uploaded; the parse request is left to the test. */
  async function sent(page: Awaited<ReturnType<typeof withFile>>) {
    await page.click('Envoyer et lire le fichier');
    page.post('').flush(run('created'));
    await page.stable();
    page.post('r1/upload/').flush(run('uploaded'));
    await page.stable();
    return page.post('r1/parse/');
  }

  /** Leaving: the unfinished run is cancelled. */
  function leave(page: Awaited<ReturnType<typeof withFile>>) {
    page.harness.fixture.destroy();
    page.post('r1/cancel/').flush(run('cancelled'));
  }

  /** « Fichier analysé »: the tiles (label value), the table of the first rows. */
  function analysis(element: HTMLElement) {
    return {
      stats: Array.from(element.querySelectorAll('.stats div')).map(
        (item) =>
          `${item.querySelector('dt')?.textContent?.trim()} ${item.querySelector('dd')?.textContent?.trim()}`,
      ),
      head: Array.from(element.querySelectorAll('.sample-table th')).map((cell) =>
        cell.textContent?.trim(),
      ),
      rows: Array.from(element.querySelectorAll('.sample-table tbody tr')).map((row) =>
        Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim()),
      ),
    };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('shows the fields the server expects, with their words', async () => {
    const { element } = await open();
    const rows = Array.from(element.querySelectorAll('.columns tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td'))
        .map((cell) => cell.textContent?.trim())
        .join(' '),
    );
    expect(rows).toEqual(['Code Oui', 'Nom Oui', 'Pays Oui', 'E-mail Non']);
  });

  it('a CSV: only the file is asked; analysed, its first rows, then the mapping', async () => {
    const page = await withFile();
    const input = page.element.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.accept).toContain('.xlsx');
    const advanced = page.element.querySelector<HTMLDetailsElement>('details.advanced')!;
    expect(advanced.open).toBe(false);
    expect(advanced.querySelector('summary')?.textContent?.trim()).toBe('Options avancées');
    const parse = await sent(page);
    // While the server reads: the button says so.
    expect(page.element.textContent).toContain('Envoi et lecture…');
    parse.flush(run('parsed', { options: { encoding: 'cp1252', delimiter: '\t' } }));
    await page.stable();
    firstRows([
      { line: 2, raw: { Code: 'C1', Nom: 'Client un', Pays: 'GN', Email: '' } },
      { line: 3, raw: { Code: 'C2', Nom: 'Client deux', Pays: 'SN', Email: 'b@x.org' } },
    ]);
    await page.stable();

    expect(page.element.querySelector('.file-name')?.textContent?.trim()).toBe('tiers.csv');
    expect(page.element.textContent).toContain('Fichier analysé');
    expect(page.element.querySelector('.file-title')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Encodage détecté : Windows (cp1252) · Séparateur détecté : Tabulation',
    );
    expect(analysis(page.element)).toEqual({
      stats: ['Format CSV / TXT', 'Colonnes détectées 4', 'Lignes de données lues 2'],
      head: ['Ligne', 'Code', 'Nom', 'Pays', 'Email'],
      rows: [
        ['2', 'C1', 'Client un', 'GN', ''],
        ['3', 'C2', 'Client deux', 'SN', 'b@x.org'],
      ],
    });
    expect(page.element.querySelector('.mapping')).toBeNull();
    await page.click('Continuer vers la correspondance des colonnes');
    expect(page.element.querySelector('.mapping')).not.toBeNull();
    leave(page);
  });

  it('an Excel workbook: its sheet, no encoding nor delimiter, its rows as read', async () => {
    const page = await withFile('plan.xlsx');
    // No CSV setting for a workbook.
    expect(page.element.querySelector('details.advanced')).toBeNull();
    const parse = await sent(page);
    expect(parse.request.body).toEqual({});
    parse.flush(
      run('parsed', {
        filename: 'plan.xlsx',
        content_type: WORKBOOK_CONTENT_TYPE,
        headers: ['Code', 'Nom du compte', 'Type'],
        options: { encoding: 'utf-8', delimiter: ',', sheet: 'Plan OHADA' },
        summary: { total: 1245 },
      }),
    );
    await page.stable();
    firstRows([
      {
        line: 2,
        raw: {
          Code: '101100',
          'Nom du compte': 'Capital engagé non appelé',
          Type: 'Capitaux propres',
        },
      },
    ]);
    await page.stable();

    expect(analysis(page.element)).toEqual({
      stats: [
        'Format Excel (.xlsx)',
        'Feuille Plan OHADA',
        'Colonnes détectées 3',
        'Lignes de données lues 1245',
      ],
      head: ['Ligne', 'Code', 'Nom du compte', 'Type'],
      rows: [['2', '101100', 'Capital engagé non appelé', 'Capitaux propres']],
    });
    expect(page.element.textContent).not.toContain('Encodage');
    expect(page.element.textContent).not.toContain('Séparateur détecté');
    expect(page.element.textContent).toContain('1 premières lignes sur 1245');
    leave(page);
  });

  it('a workbook with several sheets of data: the user chooses, then it is read', async () => {
    const page = await withFile('plan.xlsx');
    (await sent(page)).flush(
      refusal('imports_sheet_required', { sheets: ['Plan 2025', 'Plan 2026'] }),
      { status: 400, statusText: 'x' },
    );
    await page.stable();
    const radios = Array.from(
      page.element.querySelectorAll<HTMLInputElement>('.sheets input[type=radio]'),
    );
    expect(radios.map((radio) => radio.value)).toEqual(['Plan 2025', 'Plan 2026']);
    expect(page.element.textContent).toContain(
      'tiers.csv contient plusieurs feuilles avec des données.',
    );
    const read = Array.from(page.element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Lire cette feuille'),
    )!;
    expect(read.disabled).toBe(true);
    radios[1].checked = true;
    radios[1].dispatchEvent(new Event('change'));
    await page.stable();
    await page.click('Lire cette feuille');
    const parse = page.post('r1/parse/');
    expect(parse.request.body).toEqual({ sheet: 'Plan 2026' });
    parse.flush(
      run('parsed', {
        content_type: WORKBOOK_CONTENT_TYPE,
        options: { sheet: 'Plan 2026' },
      }),
    );
    await page.stable();
    firstRows();
    await page.stable();
    expect(analysis(page.element).stats).toContain('Feuille Plan 2026');
    expect(page.element.textContent).toContain('Le fichier ne contient que la ligne des en-têtes.');
    leave(page);
  });

  it('replacing the file: back to the choice, the run cancelled', async () => {
    const page = await withFile();
    (await sent(page)).flush(run('parsed', { options: { encoding: 'utf-8', delimiter: ',' } }));
    await page.stable();
    firstRows();
    await page.stable();
    await page.click('Remplacer le fichier');
    page.post('r1/cancel/').flush(run('cancelled'));
    await page.stable();
    expect(page.element.querySelector('input[type=file]')).not.toBeNull();
    expect(page.element.querySelector('.analysis')).toBeNull();
  });

  it('options avancées: only a forced value is sent, and said « choisi »', async () => {
    const page = await withFile();
    const select = page.element.querySelectorAll<HTMLSelectElement>('details.advanced select')[1];
    select.value = ';';
    select.dispatchEvent(new Event('change'));
    const parse = await sent(page);
    expect(parse.request.body).toEqual({ delimiter: ';' });
    parse.flush(run('parsed', { options: { encoding: 'utf-8', delimiter: ';' } }));
    await page.stable();
    firstRows();
    await page.stable();
    expect(page.element.textContent).toContain('Séparateur choisi');
    expect(page.element.textContent).toContain('Encodage détecté');
    leave(page);
  });

  for (const [code, text] of [
    [
      'imports_encoding_undetermined',
      'Impossible de déterminer automatiquement l’encodage du fichier.',
    ],
    [
      'imports_delimiter_undetermined',
      'Impossible de déterminer automatiquement le séparateur des colonnes.',
    ],
    ['imports_workbook_unreadable', 'Ce classeur ne peut pas être lu.'],
  ]) {
    it(`a file the server cannot read stays blocked, with the reason (${code})`, async () => {
      const page = await withFile();
      (await sent(page)).flush(envelope(code), { status: 400, statusText: 'x' });
      await page.stable();
      expect(page.element.textContent).toContain(text);
      expect(page.element.querySelector('.analysis')).toBeNull();
      leave(page);
    });
  }

  for (const name of ['plan.xls', 'plan.xlsm', 'plan.pdf']) {
    it(`a format other than CSV, TXT or XLSX is refused before sending (${name})`, async () => {
      const page = await withFile(name);
      expect(page.element.textContent).toContain(
        'Format non pris en charge. Utilisez un fichier CSV ou Excel (.xlsx).',
      );
      const send = Array.from(page.element.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Envoyer et lire le fichier'),
      );
      expect(send?.disabled).toBe(true);
    });
  }

  for (const [reason, text] of [
    ['not a text file', 'Format non pris en charge. Utilisez un fichier CSV ou Excel (.xlsx).'],
    ['macros', 'Ce classeur contient des macros.'],
    ['corrupt', 'Ce classeur ne peut pas être lu.'],
    ['too large once uncompressed', 'Ce classeur est trop volumineux.'],
  ]) {
    it(`a file refused by the server is said by its reason (${reason})`, async () => {
      const page = await withFile('plan.xlsx');
      await page.click('Envoyer et lire le fichier');
      page.post('').flush(run('created'));
      await page.stable();
      page
        .post('r1/upload/')
        .flush(refusal('imports_file_rejected', { reason }), { status: 400, statusText: 'x' });
      await page.stable();
      expect(page.element.textContent).toContain(text);
      leave(page);
    });
  }

  it('the whole import: file, mapping, checks, preview, then the only write', async () => {
    const { element, click, post, stable } = await toMapping();
    expect(element.textContent).toContain('2 lignes lues dans tiers.csv');

    await click('Contrôler les lignes');
    const map = post('r1/map/');
    // Columns named like the fields (or their words) are suggested; the user may change them.
    expect(map.request.body).toEqual({
      columns: { code: 'Code', name: 'Nom', country: 'Pays', email: 'Email' },
      // How dates and amounts are written: the server's defaults unless changed.
      options: { date_format: '%Y-%m-%d', decimal_separator: '.' },
    });
    map.flush(run('mapped'));
    await stable();
    post('r1/validate/').flush(
      run('validated', { summary: { total: 2, valid: 2, warnings: 0, errors: 0, duplicates: 0 } }),
    );
    await stable();
    expect(element.textContent).toContain('Lignes correctes2');

    await click('Voir l’aperçu');
    post('r1/preview/').flush(
      run('previewed', {
        summary: {
          total: 2,
          preview: { creations: { partners: 2 }, updates: 0, skipped_duplicates: 0 },
        },
      }),
    );
    await stable();
    expect(element.textContent).toContain('2 tiers seront créés');

    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    await click('Lancer l’import');
    const execute = post('r1/execute/');
    expect(execute.request.body).toEqual({ asynchronous: false });
    execute.flush(run('completed', { summary: { created: 2, imported: 2 } }));
    await stable();
    expect(element.textContent).toContain('Import terminé');
    expect(element.textContent).toContain('2 tiers importés');
  });

  it('refused rows: listed with the reason, nothing can be imported', async () => {
    const { element, click, post, stable } = await toMapping();
    await click('Contrôler les lignes');
    post('r1/map/').flush(run('mapped'));
    await stable();
    post('r1/validate/').flush(
      run('validated', { summary: { total: 2, valid: 1, warnings: 0, errors: 1, duplicates: 0 } }),
    );
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/imports-exports/imports/r1/rows/')
      .flush({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            line_number: 3,
            status: 'error',
            raw: {},
            messages: [
              {
                level: 'error',
                field: 'name',
                code: 'required',
                message: 'Required.',
                details: {},
              },
            ],
          },
        ],
      });
    await stable();
    expect(element.textContent).toContain('rien ne sera importé');
    const cells = Array.from(element.querySelectorAll('.refused tbody td')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(cells).toEqual(['3', 'Nom : Valeur obligatoire manquante.']);
    expect(element.textContent).not.toContain('Voir l’aperçu');
  });

  it('a required field without a column: said, nothing sent', async () => {
    const { element, click } = await toMapping();
    const select = element.querySelectorAll<HTMLSelectElement>('.mapping select')[0];
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await click('Contrôler les lignes');
    httpMock().expectNone('/api/v1/imports-exports/imports/r1/map/');
    expect(element.textContent).toContain(
      'Associez une colonne du fichier à chaque champ obligatoire.',
    );
  });

  it('without the right to check: said, no button', async () => {
    const page = await open(['partners.create', 'imports_exports.create']);
    await chooseFile(page.element, page.stable);
    await page.click('Envoyer et lire le fichier');
    page.post('').flush(run('created'));
    await page.stable();
    page.post('r1/upload/').flush(run('uploaded'));
    await page.stable();
    page.post('r1/parse/').flush(run('parsed'));
    await page.stable();
    firstRows();
    await page.stable();
    await page.click('Continuer vers la correspondance des colonnes');
    await page.click('Contrôler les lignes');
    page.post('r1/map/').flush(run('mapped'));
    await page.stable();
    httpMock().expectNone('/api/v1/imports-exports/imports/r1/validate/');
    expect(page.element.textContent).toContain(
      'Votre profil ne permet pas de contrôler cet import.',
    );
  });

  it('leaving an unfinished import cancels it on the server', async () => {
    const { harness } = await toMapping();
    await harness.navigateByUrl('/tiers');
    const cancel = httpMock().expectOne('/api/v1/imports-exports/imports/r1/cancel/');
    expect(cancel.request.body).toEqual({ reason: 'Abandonné depuis l’écran d’import.' });
    cancel.flush(run('cancelled'));
  });
});
