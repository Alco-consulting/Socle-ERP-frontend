import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { JournalBookEntry } from '../data-access/reporting-models';
import { JournalBookPage } from './journal-book-page';

const URL = '/api/v1/reporting/journal-book/';
const amount = (value: number) => `${value}.000000`;
const entry = (id: string, day: string, number: string): JournalBookEntry => ({
  public_id: id,
  entry_number: number,
  entry_date: day,
  journal_code: 'VT',
  journal_name: 'Ventes',
  description: `Facture ${number}`,
  document_reference: 'FV-2026-0001',
  lines: [
    {
      account_code: '411100',
      account_name: 'Clients',
      partner_code: 'CLI-00001',
      partner_name: 'Client Recette 01',
      label: '',
      debit: amount(1180000),
      credit: amount(0),
    },
    {
      account_code: '701100',
      account_name: 'Ventes de marchandises',
      partner_code: null,
      partner_name: null,
      label: 'Eau',
      debit: amount(0),
      credit: amount(1000000),
    },
    {
      account_code: '443100',
      account_name: 'TVA facturée',
      partner_code: null,
      partner_name: null,
      label: 'TVA 18 %',
      debit: amount(0),
      credit: amount(180000),
    },
  ],
  debit: amount(1180000),
  credit: amount(1180000),
});
const book = (results: JournalBookEntry[], count = results.length) => ({
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    date_from: '2026-10-01',
    date_to: '2026-10-31',
  },
  period: 'oct. 2026',
  journals: [
    {
      public_id: 'j-vt',
      code: 'VT',
      name: 'Ventes',
      entries: count,
      debit: amount(1180000 * count),
      credit: amount(1180000 * count),
    },
  ],
  debit: amount(1180000 * count),
  credit: amount(1180000 * count),
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('JournalBookPage (Analyse › Livre-journal, note backend 0068)', () => {
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

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'livre-journal', component: JournalBookPage },
          { path: '**', children: [] },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), {
      permissions: ['reporting.read'],
      companies: [{ ...TEST_COMPANY, currency: 'GNF' }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/livre-journal');
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
    return { element, stable };
  }

  it('the month by default: each entry and its lines, then the totals of each journal', async () => {
    const { element, stable } = await open();
    const request = httpMock().expectOne((req) => req.url === URL);
    expect(request.request.params.get('date_from')).toBe('2026-10-01');
    expect(request.request.params.get('date_to')).toBe('2026-10-31');
    expect(request.request.params.get('page_size')).toBe('50');
    request.flush(book([entry('e-1', '2026-10-05', 'VT-2026-000001')]));
    await stable();

    expect(text(element.querySelector('h1'))).toBe('Livre-journal');
    const head = element.querySelector('.entry-head')!;
    expect(text(head)).toContain('05/10/2026');
    expect(text(head)).toContain('VT-2026-000001');
    expect(text(head)).toContain('Réf. FV-2026-0001');
    const cells = (row: Element) => Array.from(row.querySelectorAll('td, th')).map(text);
    const lines = Array.from(element.querySelectorAll('tbody.entry tr:not(.entry-head)'));
    // Date (on the entry's head), account, label, partner, debit, credit.
    expect(lines.map(cells)).toEqual([
      ['', '411100Clients', 'Facture VT-2026-000001', 'Client Recette 01', '1 180 000', ''],
      ['', '701100Ventes de marchandises', 'Eau', '', '', '1 000 000'],
      ['', '443100TVA facturée', 'TVA 18 %', '', '', '180 000'],
    ]);
    const totals = element.querySelector('table.totals')!;
    expect(cells(totals.querySelector('tbody tr')!)).toEqual([
      'VT Ventes',
      '1',
      '1 180 000',
      '1 180 000',
    ]);
    expect(cells(totals.querySelector('tfoot tr')!)).toEqual([
      'Total du livre-journal',
      '1',
      '1 180 000',
      '1 180 000',
    ]);
  });

  it('« Imprimer » reads every page, then prints the whole book', async () => {
    const { element, stable } = await open();
    httpMock()
      .expectOne((req) => req.url === URL)
      .flush(book([entry('e-1', '2026-10-05', 'VT-2026-000001')], 2));
    await stable();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);

    Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => text(button) === 'Imprimer')!
      .click();
    await stable();
    const all = httpMock().expectOne((req) => req.url === URL);
    expect(all.request.params.get('page_size')).toBe('200');
    all.flush(
      book(
        [
          entry('e-1', '2026-10-05', 'VT-2026-000001'),
          entry('e-2', '2026-10-09', 'VT-2026-000002'),
        ],
        2,
      ),
    );
    await stable();
    await stable();

    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
