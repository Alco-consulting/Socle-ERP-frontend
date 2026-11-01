import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { IncomeStatementPage } from './income-statement-page';

const amount = (value: number) => `${value}.000000`;
const line = (code: string, name: string, value = 0, accounts: string[][] = []) => ({
  code,
  name,
  amount: amount(value),
  accounts: accounts.map(([accountCode, accountName, accountValue]) => ({
    public_id: `a-${accountCode}`,
    code: accountCode,
    name: accountName,
    amount: amount(accountValue === undefined ? value : Number(accountValue)),
  })),
});
const block = (code: string, name: string, total: number, lines: unknown[]) => ({
  code,
  name,
  total: amount(total),
  lines,
});
const statement = (options: { profit?: number; loss?: number; warnings?: unknown[] } = {}) => ({
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    date_from: '2026-01-01',
    date_to: '2026-12-31',
  },
  charges: {
    blocks: [
      block('operating', 'Charges d’exploitation', 400000, [
        line('60', 'Achats et variations de stocks', 400000, [
          ['601100', 'Achats'],
          ['603100', 'Variations des stocks', '0'],
        ]),
        line('61', 'Transports'),
      ]),
      block('tax', 'Participation et impôt sur le résultat', 0, [line('89', 'Impôts')]),
    ],
    total: amount(400000),
  },
  products: {
    blocks: [
      block('operating', 'Produits d’exploitation', 1000000, [
        line('70', 'Ventes', 1000000, [['701100', 'Ventes de marchandises']]),
      ]),
    ],
    total: amount(1000000),
  },
  result: amount((options.profit ?? 600000) - (options.loss ?? 0)),
  profit: amount(options.profit ?? 600000),
  loss: amount(options.loss ?? 0),
  total: amount(1000000),
  unclassified: [],
  warnings: options.warnings ?? [],
});
const READER = [
  'reporting.read_financial_statements',
  'imports_exports.read',
  'imports_exports.export',
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const texts = (element: Element | null | undefined, selector: string) =>
  [...(element?.querySelectorAll(selector) ?? [])].map((item) => text(item));

describe('IncomeStatementPage (Analyse › Compte de résultat, en tableau)', () => {
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

  async function open(url = '/resultat', permissions: string[] = READER) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'resultat', component: IncomeStatementPage },
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
    httpMock()
      .expectOne((req) => req.url === '/api/v1/currencies/')
      .flush({
        count: 1,
        next: null,
        previous: null,
        results: [{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }],
      });
    const asked = () =>
      httpMock().expectOne((req) => req.url === '/api/v1/reporting/income-statement/');
    return { element, stable, asked };
  }

  it('the year by default: charges facing products, the profit with the charges', async () => {
    const { element, stable, asked } = await open();
    const request = asked();
    expect(request.request.params.get('date_from')).toBe('2026-01-01');
    expect(request.request.params.get('date_to')).toBe('2026-12-31');
    request.flush(statement());
    await stable();

    const bar = element.querySelector('.report-bar');
    expect(text(bar?.querySelector('h1'))).toBe('Compte de résultat');
    expect(texts(bar, 'button').slice(0, 2)).toEqual(['PDF', 'XLSX']);
    expect(text(bar)).toContain('2026');
    expect(texts(element, 'table.block caption')).toEqual([
      'Charges d’exploitation',
      'Produits d’exploitation',
      'Participation et impôt sur le résultat',
    ]);
    // The block's total on its title's line, no Total line under it.
    expect(texts(element.querySelector('table.block'), '.block-head')).toEqual([
      'Charges d’exploitation 400 000',
    ]);
    // The accounts themselves, not their two-digit lines; those at zero are not shown.
    expect(texts(element.querySelector('table.block'), 'tbody tr')).toEqual([
      '601100 Achats 400 000',
    ]);
    expect(element.querySelector('table.block tfoot')).toBeNull();
    expect(text(element.querySelector('.result.left'))).toBe('Bénéfice 600 000');
    expect(text(element.querySelector('.result.right'))).toBe('Perte');
    expect(texts(element, '.grand-total')).toEqual(['Total 1 000 000', 'Total 1 000 000']);
    // Products face charges: an empty place stands for the missing block.
    expect(element.querySelectorAll('.block--empty.right')).toHaveLength(1);
  });

  it('a loss is written with the products', async () => {
    const { element, stable, asked } = await open();
    asked().flush(statement({ profit: 0, loss: 250000 }));
    await stable();

    expect(text(element.querySelector('.result.left'))).toBe('Bénéfice');
    expect(text(element.querySelector('.result.right'))).toBe('Perte 250 000');
  });

  it('each account leads to its general ledger on the same dates', async () => {
    const { element, stable, asked } = await open();
    asked().flush(statement());
    await stable();

    expect(element.querySelector('button.fold')).toBeNull();
    // An account at zero is not shown (603100).
    expect(element.querySelectorAll('tr.account')).toHaveLength(2);
    const link = element.querySelector<HTMLAnchorElement>('tr.account a');
    expect(text(link)).toBe('601100 Achats');
    expect(link?.getAttribute('href')).toBe(
      '/app/comptabilite/analyse/grand-livre?compte=601100&periode=perso&du=2026-01-01&au=2026-12-31',
    );
  });

  it('the month chosen in the date menu is read and kept in the URL', async () => {
    const { element, stable, asked } = await open();
    asked().flush(statement());
    await stable();

    element.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.click();
    await stable();
    const panel = document.querySelector('[role="dialog"][aria-label="Période"]');
    [...(panel?.querySelectorAll<HTMLButtonElement>('button.choice') ?? [])]
      .find((button) => text(button) === 'Mois')
      ?.click();
    await stable();

    const october = asked();
    expect(october.request.params.get('date_from')).toBe('2026-10-01');
    expect(october.request.params.get('date_to')).toBe('2026-10-31');
    october.flush(statement());
    await stable();
    expect(TestBed.inject(Router).url).toContain('periode=mois');
  });

  it('the server’s warnings in words: drafts left out, the result against the books', async () => {
    const { element, stable, asked } = await open();
    asked().flush(
      statement({
        warnings: [
          { code: 'unposted_entries', message: '', details: { count: 2 } },
          {
            code: 'income_statement_result_mismatch',
            message: '',
            details: { statement: '600000.000000', books: '600007.000000' },
          },
        ],
      }),
    );
    await stable();

    const notes = texts(element, '.banner');
    expect(notes[0]).toContain('pièces non comptabilisées');
    expect(notes[1]).toContain('Le résultat de l’état (600 000) diffère du résultat des livres');
    expect(notes[1]).toContain('(600 007)');
  });

  it('a company outside SYSCOHADA is told so', async () => {
    const { element, stable, asked } = await open();
    asked().flush(
      {
        error: {
          code: 'reporting_income_statement_unavailable',
          message: '',
          details: null,
          correlation_id: 'c1',
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await stable();

    expect(text(element)).toContain('Pas de compte de résultat pour cette société.');
  });

  it('no export buttons without the right to export', async () => {
    const { element, stable, asked } = await open('/resultat', [
      'reporting.read_financial_statements',
    ]);
    asked().flush(statement());
    await stable();

    expect(texts(element.querySelector('.report-exports'), 'button')).toEqual([]);
  });
});
