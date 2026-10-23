import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { GeneralLedgerPage } from './general-ledger-page';

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const amount = (value: number) => `${value}.000000`;
const SCOPE = {
  fiscal_year: { public_id: 'fy-2026', code: '2026' },
  period: null,
  date_from: '2026-10-01',
  date_to: '2026-10-31',
};
const account = (code: string, name: string) => ({
  public_id: `a-${code}`,
  code,
  name,
  account_type: 'asset',
});
/** The figures of the user's Odoo capture (Mattco, October 2026). */
const row = (
  code: string,
  name: string,
  [openingDebit, openingCredit, debit, credit]: number[],
) => ({
  account: account(code, name),
  opening_debit: amount(openingDebit),
  opening_credit: amount(openingCredit),
  opening: amount(openingDebit - openingCredit),
  debit: amount(debit),
  credit: amount(credit),
  total_debit: amount(openingDebit + debit),
  total_credit: amount(openingCredit + credit),
  closing: amount(openingDebit - openingCredit + debit - credit),
  drilldown: { level: 'ledger', account: `a-${code}` },
});
const CASH = row('571001', 'Caisse Principale', [19534000, 0, 0, 13576500]);
const CAPITAL = row('101300', 'Capital souscrit, appelé, versé, non amorti', [0, 5000000, 0, 0]);
const ledgerOf = (rows: unknown[] = [CAPITAL, CASH], warnings: unknown[] = []) => ({
  scope: SCOPE,
  comparative_scope: null,
  period: 'oct. 2026',
  totals: row('', '', [19534000, 5000000, 0, 13576500]),
  warnings,
  ...page(rows),
});
const line = (index: number, label: string, credit: number, balance: number) => ({
  line: `l-${index}`,
  entry: `e-${index}`,
  entry_date: `2026-10-0${index}`,
  entry_number: `CAISS/2026/0000${index}`,
  journal: 'CAISS',
  account: 'a-571001',
  account_code: '571001',
  label,
  document_reference: '',
  partner: index === 2 ? { public_id: 'p-1', code: 'FRN-1', name: 'BANKITY BTP' } : null,
  debit: amount(0),
  credit: amount(credit),
  balance: amount(balance),
});
const linesOf = (rows: unknown[], count: number) => ({
  scope: SCOPE,
  comparative_scope: null,
  account: account('571001', 'Caisse Principale'),
  opening_balance: amount(19534000),
  opening_debit: amount(19534000),
  opening_credit: amount(0),
  total_debit: amount(0),
  total_credit: amount(13576500),
  closing_balance: amount(5957500),
  warnings: [],
  ...page(rows, count),
});
const ACCOUNTANT = [
  'accounting.read',
  'reporting.read',
  'imports_exports.read',
  'imports_exports.export',
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cells = (element: Element | null | undefined, selector = 'td') =>
  [...(element?.querySelectorAll(selector) ?? [])].map((cell) => text(cell));

describe('GeneralLedgerPage (Analyse › Grand livre général, as Odoo’s)', () => {
  beforeEach(() => {
    setCookie('XSRF-TOKEN', 'tok');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 22, 10));
  });
  afterEach(() => {
    httpMock().verify();
    vi.useRealTimers();
    clearCookie('XSRF-TOKEN');
  });

  async function open(url: string, permissions: string[] = ACCOUNTANT) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'grand-livre', component: GeneralLedgerPage },
          { path: '**', children: [] },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), {
      permissions,
      companies: [{ ...TEST_COMPANY, currency: 'GNF' }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    const references = async () => {
      httpMock()
        .expectOne((req) => req.url === '/api/v1/accounting/journals/')
        .flush(page([]));
      httpMock()
        .expectOne((req) => req.url === '/api/v1/currencies/')
        .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
      await stable();
    };
    const general = () =>
      httpMock().expectOne((req) => req.url === '/api/v1/reporting/general-ledger/');
    const lines = () =>
      httpMock().expectOne((req) => req.url === '/api/v1/reporting/ledger/a-571001/');
    return { element, stable, references, general, lines };
  }

  it('this month, Odoo’s bar and columns, one line per account with its totals', async () => {
    const { element, stable, references, general } = await open('/grand-livre');
    await references();
    const request = general();
    expect(request.request.params.get('date_from')).toBe('2026-10-01');
    expect(request.request.params.get('date_to')).toBe('2026-10-31');
    expect(request.request.params.has('account')).toBe(false);
    request.flush(ledgerOf());
    await stable();

    const bar = element.querySelector('.report-bar');
    expect(cells(bar, 'button').slice(0, 2)).toEqual(['PDF', 'XLSX']);
    expect(text(bar?.querySelector('h1'))).toBe('Grand livre général');
    expect(text(bar)).toContain('oct. 2026');
    expect(text(bar)).not.toContain('Comparaison');
    expect(text(bar)).toContain('Pièces comptabilisées, Comptabilité d’engagement');
    expect(text(bar)).toContain('En GNF');
    expect(cells(element.querySelector('.heads'), 'th')).toEqual(['oct. 2026']);
    expect(cells(element.querySelector('.subheads'), 'th')).toEqual([
      'Compte',
      'Date',
      'Partenaire',
      'Débit',
      'Crédit',
      'Solde',
    ]);
    const [capital, cash] = [...element.querySelectorAll('tr.account-row')];
    expect(text(cash.querySelector('th'))).toBe('571001 Caisse Principale');
    expect(cells(cash)).toEqual(['', '', '19 534 000 GNF', '13 576 500 GNF', '5 957 500 GNF']);
    expect(capital.querySelectorAll('td')[4].classList).toContain('negative');
    expect(cells(element.querySelector('tfoot'))).toEqual([
      '',
      '',
      '19 534 000 GNF',
      '18 576 500 GNF',
      '957 500 GNF',
    ]);
  });

  it('an account unfolded: its « Solde initial », its lines, « Charger plus », its entries', async () => {
    const { element, stable, references, general, lines } = await open('/grand-livre');
    await references();
    general().flush(ledgerOf());
    await stable();

    const cash = element.querySelectorAll('tr.account-row')[1];
    cash.querySelector<HTMLButtonElement>('button.fold')?.click();
    await stable();
    const first = lines();
    expect(first.request.params.get('fiscal_year')).toBe('fy-2026');
    expect(first.request.params.get('date_from')).toBe('2026-10-01');
    expect(first.request.params.get('page_size')).toBe('80');
    first.flush(
      linesOf(
        [
          line(2, 'REGLEMENT FACTURE LOYER DU SIEGE ALCO', 12000000, 7534000),
          line(3, 'REGLEMENT FACTURE DE LA PEINTURE', 778000, 6756000),
        ],
        3,
      ),
    );
    await stable();

    expect(cash.querySelector('button.fold')?.getAttribute('aria-expanded')).toBe('true');
    expect(cash.querySelector('a.lines-link')?.getAttribute('href')).toBe(
      '/app/comptabilite/ecritures?classe=571001&du=2026-10-01&au=2026-10-31',
    );
    const initial = element.querySelector('tr.initial');
    expect(text(initial?.querySelector('th'))).toBe('Solde initial');
    expect(cells(initial)).toEqual(['', '', '19 534 000 GNF', '0 GNF', '19 534 000 GNF']);
    const [loyer] = [...element.querySelectorAll('tr.line')];
    expect(text(loyer.querySelector('.name'))).toBe(
      'CAISS/2026/00002 REGLEMENT FACTURE LOYER DU SIEGE ALCO',
    );
    expect(cells(loyer)).toEqual([
      '02/10/2026',
      'BANKITY BTP',
      '0 GNF',
      '12 000 000 GNF',
      '7 534 000 GNF',
    ]);

    const more = [...element.querySelectorAll<HTMLButtonElement>('tr.more-row button')].find(
      (button) => text(button) === 'Charger plus…',
    );
    more?.click();
    await stable();
    const second = lines();
    expect(second.request.params.get('page')).toBe('2');
    second.flush(linesOf([line(4, 'FRAIS D’ACHAT EAU', 25500, 6730500)], 3));
    await stable();
    expect(element.querySelectorAll('tr.line')).toHaveLength(3);
    expect(element.querySelector('tr.more-row')).toBeNull();

    cash.querySelector<HTMLButtonElement>('button.fold')?.click();
    await stable();
    expect(element.querySelectorAll('tr.line')).toHaveLength(0);
  });

  it('one account from the URL: found by its code, alone and unfolded', async () => {
    const { element, stable, references, general, lines } = await open(
      '/grand-livre?compte=571001',
    );
    await references();
    const byCode = httpMock().expectOne((req) => req.url === '/api/v1/accounting/accounts/');
    expect(byCode.request.params.get('code')).toBe('571001');
    byCode.flush(page([{ public_id: 'a-571001', code: '571001', name: 'Caisse Principale' }]));
    await stable();
    const request = general();
    expect(request.request.params.get('account')).toBe('a-571001');
    request.flush(ledgerOf([CASH]));
    await stable();
    lines().flush(linesOf([], 0));
    await stable();
    expect(element.querySelector('tr.initial')).not.toBeNull();
  });

  it('an unknown code: said, no ledger asked', async () => {
    const { element, stable, references } = await open('/grand-livre?compte=999');
    await references();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/')
      .flush(page([]));
    await stable();
    httpMock().expectNone((req) => req.url.includes('/reporting/'));
    expect(text(element)).toContain('Aucun compte de cette société n’a le code « 999 ».');
  });

  it('the ⋮ of a line opens its entry', async () => {
    const { stable, references, general, lines } = await open('/grand-livre?compte=571001');
    await references();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/accounting/accounts/')
      .flush(page([{ public_id: 'a-571001', code: '571001', name: 'Caisse Principale' }]));
    await stable();
    general().flush(ledgerOf([CASH]));
    await stable();
    lines().flush(linesOf([line(2, 'LOYER', 12000000, 7534000)], 1));
    await stable();

    document
      .querySelector<HTMLButtonElement>('[aria-label="Actions de la ligne CAISS/2026/00002"]')
      ?.click();
    await stable();
    const item = document.querySelector<HTMLElement>('[role="menuitem"]');
    expect(text(item)).toBe('Voir la pièce');
    item?.click();
    await stable();
    expect(TestBed.inject(Router).url).toBe('/app/comptabilite/ecritures/e-2');
  });

  it('drafts left out: Odoo’s banner; PDF: the same ledger asked as an export', async () => {
    const createUrl = vi.fn(() => 'blob:ledger');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const { element, stable, references, general } = await open('/grand-livre?q=57');
    await references();
    const request = general();
    expect(request.request.params.get('search')).toBe('57');
    request.flush(
      ledgerOf([CASH], [{ code: 'unposted_entries', message: '', details: { count: 1 } }]),
    );
    await stable();
    expect(text(element.querySelector('.banner'))).toBe(
      'Il y a des pièces non comptabilisées avant ou au cours de cette période.',
    );

    element
      .querySelector<HTMLButtonElement>('[aria-label="Télécharger le grand livre en PDF"]')
      ?.click();
    await stable();
    const created = httpMock().expectOne('/api/v1/imports-exports/exports/');
    expect(created.request.body).toEqual({
      export_type: 'reporting.general_ledger',
      file_format: 'pdf',
      parameters: {
        date_from: '2026-10-01',
        date_to: '2026-10-31',
        journal: [],
        include_unposted: false,
        search: '57',
      },
      asynchronous: false,
    });
    created.flush({ public_id: 'x1', status: 'completed', filename: 'grand-livre.pdf' });
    await stable();
    httpMock()
      .expectOne('/api/v1/imports-exports/exports/x1/download/')
      .flush(new Blob(['%PDF']), {
        headers: { 'Content-Disposition': 'attachment; filename="grand-livre.pdf"' },
      });
    await stable();
    expect(createUrl).toHaveBeenCalled();
  });
});
