import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
import { EntryLineRow } from '../data-access/entry-lines-api';
import { EntryLinesPage } from './entry-lines';
import { page } from './entry-testing';

registerLocaleData(localeFr); // the app's locale (app.config.ts): « 5 oct. »

const BASE = '/app/comptabilite/ecritures';
const JOURNAL = { public_id: 'j-vt', code: 'VT', name: 'Ventes', journal_type: 'sale' };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const is = (path: string) => (req: { url: string; method: string }) =>
  req.url === `/api/v1/${path}` && req.method === 'GET';
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');
const YEAR = new Date().getFullYear();
/** The buttons of the classes panel: « Tous », « 4 », « 41 »… */
const prefixes = (element: Element) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>('.prefix')).map((button) => ({
    button,
    label: text(button).trim(),
  }));
const CLASSES = [
  {
    prefix: '4',
    count: 30,
    children: [
      { prefix: '41', count: 18 },
      { prefix: '44', count: 12 },
    ],
  },
  { prefix: '7', count: 22, children: [{ prefix: '70', count: 22 }] },
];

function row(id: string, extra: Partial<EntryLineRow> = {}): EntryLineRow {
  return {
    public_id: id,
    entry: {
      public_id: 'e-1',
      entry_number: 'FV-000001',
      status: 'validated',
      entry_date: `${YEAR}-10-05`,
      description: 'Facture FV-000001',
      document_reference: '',
    },
    journal: { public_id: 'j-vt', code: 'VT' },
    sequence: 1,
    account: { public_id: 'a-411', code: '411100', name: 'Clients' },
    partner: { public_id: 'pt-1', code: 'CLI-00001', name: 'Kaba Négoce' },
    label: '',
    debit: '1180000.00',
    credit: '0.00',
    currency: 'GNF',
    reference_debit: '1180000.00',
    reference_credit: '0.00',
    reference_currency: 'GNF',
    lettering: null,
    ...extra,
  };
}

describe('Comptabilité › Écritures comptables (accounting/entry-lines/)', () => {
  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        { provide: LOCALE_ID, useValue: 'fr-FR' },
        provideRouter([{ path: 'app/comptabilite/ecritures', component: EntryLinesPage }]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions: ['accounting.read'] });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = () => harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    httpMock()
      .expectOne(is('accounting/journals/'))
      .flush(page([JOURNAL]));
    return { harness, element, stable };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('the URL’s criteria go to the server; the lines and the classes as it gives them', async () => {
    const { element, stable } = await open(
      `${BASE}?etat=all&journal=j-vt&du=2026-10-01&au=2026-10-31&q=kaba&classe=41&page=2`,
    );
    await stable();
    const lines = httpMock().expectOne(is('accounting/entry-lines/'));
    const params = lines.request.params;
    expect(params.get('state')).toBe('all');
    expect(params.get('journal')).toBe('j-vt');
    expect(params.get('date_from')).toBe('2026-10-01');
    expect(params.get('date_to')).toBe('2026-10-31');
    expect(params.get('search')).toBe('kaba');
    expect(params.get('account_prefix')).toBe('41');
    expect(params.get('page')).toBe('2');
    const classes = httpMock().expectOne(is('accounting/entry-lines/classes/'));
    expect(classes.request.params.get('search')).toBe('kaba');
    expect(classes.request.params.has('account_prefix')).toBe(false);
    lines.flush(
      page(
        [
          row('l-1', { lettering: 'LET-000001' }),
          row('l-2', {
            entry: { ...row('l-0').entry, public_id: 'e-0', entry_date: '2025-12-31' },
            sequence: 2,
            account: { public_id: 'a-443', code: '443100', name: 'TVA facturée' },
            partner: null,
            label: 'TVA 18 %',
            debit: '0.00',
            credit: '180000.00',
            reference_debit: '0.00',
            reference_credit: '180000.00',
          }),
        ],
        52,
      ),
    );
    classes.flush(CLASSES);
    await stable();

    const rows = Array.from(element().querySelectorAll('tbody tr')).map(text);
    expect(rows[0]).toContain('5 oct.'); // this year: no year
    expect(rows[0]).not.toContain(String(YEAR));
    expect(rows[0]).toContain('FV-000001');
    expect(rows[0]).toContain('411100 Clients');
    expect(rows[0]).toContain('Kaba Négoce');
    expect(rows[0]).toContain('Facture FV-000001'); // no label: the entry's description
    expect(rows[0]).toContain('1 180 000 GNF');
    expect(rows[0]).toContain('LET-000001');
    expect(rows[1]).toContain('31 déc. 2025');
    expect(rows[1]).toContain('TVA 18 %');
    // As in Odoo: a zero side shows « 0 GNF », muted.
    expect(rows[1]).toContain('0 GNF');
    expect(rows[1]).toContain('180 000 GNF');
    expect(element().querySelectorAll('tbody tr')[1].querySelector('.zero')?.textContent).toContain(
      '0 GNF',
    );
    expect(element().querySelector(`a[href="${BASE}/e-1"]`)).not.toBeNull();
    // The class of the URL's group starts unfolded; no counts, as in Odoo.
    expect(prefixes(element()).map((item) => item.label)).toEqual(['Tous', '4', '41', '44', '7']);
    const fold = element().querySelector<HTMLButtonElement>('button[aria-label="Déplier 7"]')!;
    fold.click();
    await stable();
    expect(prefixes(element()).map((item) => item.label)).toEqual([
      'Tous',
      '4',
      '41',
      '44',
      '7',
      '70',
    ]);

    // Ticked lines: their debit and credit, as in Odoo.
    const boxes = element().querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]');
    boxes[0].click();
    boxes[1].click();
    await stable();
    const footer = text(element().querySelector('tfoot')!);
    expect(footer).toContain('2 sélectionnées');
    expect(footer).toContain('1 180 000 GNF');
    expect(footer).toContain('180 000 GNF');
    // Nothing is entered here.
    expect(text(element())).not.toContain('Nouvelle écriture');
  });

  it('a class chosen: in the URL, unfolded, the page back to 1', async () => {
    const { element, stable } = await open(`${BASE}?page=3`);
    await stable();
    httpMock()
      .expectOne(is('accounting/entry-lines/'))
      .flush(page([row('l-1')], 120));
    httpMock()
      .expectOne(is('accounting/entry-lines/classes/'))
      .flush([{ prefix: '6', count: 12, children: [{ prefix: '60', count: 12 }] }]);
    await stable();
    expect(prefixes(element()).map((item) => item.label)).toEqual(['Tous', '6']);
    prefixes(element())
      .find((item) => item.label === '6')!
      .button.click();
    await stable();
    expect(prefixes(element()).map((item) => item.label)).toEqual(['Tous', '6', '60']);
    expect(TestBed.inject(Router).url).toBe(`${BASE}?classe=6`);
    const lines = httpMock().expectOne(is('accounting/entry-lines/'));
    expect(lines.request.params.get('account_prefix')).toBe('6');
    expect(lines.request.params.has('page')).toBe(false);
    lines.flush(page([row('l-1')]));
    // The same filters: the classes are not asked again.
    httpMock().expectNone(is('accounting/entry-lines/classes/'));
    await stable();
  });

  it('empty, without criteria: where entries come from; forbidden: said', async () => {
    const first = await open(BASE);
    await first.stable();
    httpMock().expectOne(is('accounting/entry-lines/')).flush(page());
    httpMock().expectOne(is('accounting/entry-lines/classes/')).flush([]);
    await first.stable();
    expect(text(first.element())).toContain('Aucune écriture comptabilisée pour l’instant.');
    TestBed.resetTestingModule();

    const second = await open(BASE);
    await second.stable();
    httpMock()
      .expectOne(is('accounting/entry-lines/'))
      .flush(envelope('permission_denied'), { status: 403, statusText: 'Forbidden' });
    httpMock().expectOne(is('accounting/entry-lines/classes/')).flush([]);
    await second.stable();
    expect(text(second.element())).toContain(
      'Vous n’avez pas accès aux écritures de cette société.',
    );
  });
});
