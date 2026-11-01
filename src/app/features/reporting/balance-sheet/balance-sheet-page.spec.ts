import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { BalanceSheetPage } from './balance-sheet-page';

const amount = (value: number) => `${value}.000000`;
const account = (code: string, name: string, value: number) => ({
  public_id: `a-${code}`,
  code,
  name,
  amount: amount(value),
});
const block = (
  code: string,
  name: string,
  row: number,
  total: number,
  accounts: unknown[],
  result: number | null = null,
) => ({
  code,
  name,
  row,
  total: amount(total),
  accounts,
  result: result === null ? null : amount(result),
});
const sheet = (warnings: unknown[] = []) => ({
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    date_from: '2026-01-01',
    date_to: '2026-12-31',
  },
  assets: {
    blocks: [
      block('fixed', 'Actif immobilisé', 1, 2000000, [
        account('244100', 'Matériel', 3000000),
        account('284100', 'Amortissements', -1000000),
      ]),
      block('current', 'Actif circulant', 3, 0, [account('411100', 'Clients', 0)]),
      block('cash', 'Trésorerie actif', 4, 12500000, [account('521000', 'Banque', 12500000)]),
    ],
    total: amount(14500000),
  },
  liabilities: {
    blocks: [
      block(
        'equity',
        'Capitaux propres',
        1,
        12500000,
        [account('101300', 'Capital', 10000000)],
        2500000,
      ),
      block('financial', 'Dettes financières', 2, 2000000, [
        account('162000', 'Emprunts', 2000000),
      ]),
      block('current', 'Passif circulant', 3, 0, []),
      block('cash', 'Trésorerie passif', 4, 0, []),
    ],
    total: amount(14500000),
  },
  result: amount(2500000),
  result_name: 'Résultat de l’exercice',
  unclassified: [],
  warnings,
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

describe('BalanceSheetPage (Analyse › Bilan, en tableau)', () => {
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

  async function open(url = '/bilan', permissions: string[] = READER) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'bilan', component: BalanceSheetPage },
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
      httpMock().expectOne((req) => req.url === '/api/v1/reporting/balance-sheet/');
    return { element, stable, asked };
  }

  it('at the end of the year by default: assets facing liabilities, both totals', async () => {
    const { element, stable, asked } = await open();
    const request = asked();
    expect(request.request.params.get('date_from')).toBe('2026-01-01');
    expect(request.request.params.get('date_to')).toBe('2026-12-31');
    request.flush(sheet());
    await stable();

    const bar = element.querySelector('.report-bar');
    expect(text(bar?.querySelector('h1'))).toBe('Bilan');
    expect(texts(bar, 'button').slice(0, 2)).toEqual(['PDF', 'XLSX']);
    expect(text(bar)).toContain('Au 31/12/2026');
    expect(texts(element, '.side-head')).toEqual(['ActifMontant', 'PassifMontant']);
    // Blocks of a row face each other: Dettes financières alone in its row.
    expect(texts(element, 'table.block caption')).toEqual([
      'Actif immobilisé',
      'Capitaux propres',
      'Dettes financières',
      'Actif circulant',
      'Passif circulant',
      'Trésorerie actif',
      'Trésorerie passif',
    ]);
    expect(element.querySelectorAll('.block--empty.left')).toHaveLength(1);
    const [fixed, equity] = [...element.querySelectorAll('table.block')];
    expect(texts(fixed, 'tr')).toEqual([
      'Actif immobilisé 2 000 000',
      '244100 Matériel 3 000 000',
      '284100 Amortissements -1 000 000',
    ]);
    expect(texts(equity, 'tr')).toEqual([
      'Capitaux propres 12 500 000',
      '101300 Capital 10 000 000',
      'Résultat de l’exercice 2 500 000',
    ]);
    expect(texts(element, '.grand-total')).toEqual([
      'Total actif 14 500 000',
      'Total passif 14 500 000',
    ]);
    // An account at zero is not shown (411100).
    expect(text(element)).not.toContain('411100');
  });

  it('an account leads to its ledger, the result to the compte de résultat, from the year’s start', async () => {
    const { element, stable, asked } = await open('/bilan?periode=mois&date=2026-03-01');
    const march = asked();
    expect(march.request.params.get('date_to')).toBe('2026-03-31');
    march.flush({ ...sheet(), scope: { ...sheet().scope, date_to: '2026-03-31' } });
    await stable();

    const links = [...element.querySelectorAll<HTMLAnchorElement>('tr.account a')];
    expect(links[0].getAttribute('href')).toBe(
      '/app/comptabilite/analyse/grand-livre?compte=244100&periode=perso&du=2026-01-01&au=2026-03-31',
    );
    const result = links.find((link) => text(link) === 'Résultat de l’exercice');
    expect(result?.getAttribute('href')).toBe(
      '/app/comptabilite/analyse/resultat?periode=perso&du=2026-01-01&au=2026-03-31',
    );
  });

  it('the server’s warnings in words: drafts, accounts placed nowhere, the totals’ gap', async () => {
    const { element, stable, asked } = await open();
    asked().flush({
      ...sheet([
        { code: 'unposted_entries', message: '', details: { count: 1 } },
        {
          code: 'balance_sheet_unbalanced',
          message: '',
          details: { assets: '14499900.000000', liabilities: '14500000.000000' },
        },
      ]),
      unclassified: [account('901000', 'Engagements', 100)],
    });
    await stable();

    const notes = texts(element, '.banner');
    expect(notes[0]).toContain('pièces non comptabilisées');
    expect(notes[1]).toContain('901000 Engagements (100)');
    expect(notes[2]).toBe('Le total actif (14 499 900) diffère du total passif (14 500 000).');
  });

  it('a company outside SYSCOHADA is told so', async () => {
    const { element, stable, asked } = await open();
    asked().flush(
      {
        error: {
          code: 'reporting_balance_sheet_unavailable',
          message: '',
          details: null,
          correlation_id: 'c1',
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await stable();

    expect(text(element)).toContain('Pas de bilan pour cette société.');
  });
});
