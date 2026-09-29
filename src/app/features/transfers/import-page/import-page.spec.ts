import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PARTNER_TRANSFER } from '../../partners/partner-presentation';
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
    expect(parse.request.body).toEqual({ encoding: 'utf-8', delimiter: ',' });
    parse.flush(run('parsed'));
    await page.stable();
    return page;
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

  it('the whole import: file, mapping, checks, preview, then the only write', async () => {
    const { element, click, post, stable } = await toMapping();
    expect(element.textContent).toContain('2 lignes lues dans tiers.csv');

    await click('Contrôler les lignes');
    const map = post('r1/map/');
    // Columns named like the fields (or their words) are suggested; the user may change them.
    expect(map.request.body).toEqual({
      columns: { code: 'Code', name: 'Nom', country: 'Pays', email: 'Email' },
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
