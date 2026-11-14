import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { BalancePage } from './balance-page';

const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const journal = (code: string, name: string) => ({
  public_id: `j-${code}`,
  code,
  name,
  journal_type: 'general',
  default_currency: null,
  default_account: null,
  sequence_prefix: '',
  sequence_padding: 6,
  status: 'active',
  created_at: '',
  updated_at: '',
});
const JOURNALS = [journal('VT', 'Ventes'), journal('AC', 'Achats')];
const ZERO = '0.000000';
const amount = (value: number) => `${value}.000000`;
const move = (debit = 0, credit = 0) => ({ debit: amount(debit), credit: amount(credit) });
const row = (code: string, name: string, opening: number, moves: object[], closing: number) => ({
  account: { public_id: `a-${code}`, code, name, account_type: 'other' },
  opening: amount(opening),
  debit: ZERO,
  credit: ZERO,
  closing: amount(closing),
  movements: moves,
  comparison: null,
});
const OCTOBER = { date_from: '2026-10-01', date_to: '2026-10-31', label: 'oct. 2026' };
const SEPTEMBER = { date_from: '2026-09-01', date_to: '2026-09-30', label: 'sept. 2026' };
/** The figures of the user's Odoo capture (Mattco, October 2026). */
const ROWS = [
  row('101300', 'Capital souscrit, appelé, versé, non amorti', -5000000, [move()], -5000000),
  row('401100', 'Fournisseurs', 0, [move(12803500, 12803500)], 0),
  row('411100', 'Clients', 8000000, [move(72914000)], 80914000),
  row('701100', 'Vente de marchandises dans la région', 0, [move(0, 22914000)], -22914000),
];
const groupOf = (code: string, name: string, level: number) => ({
  code,
  name,
  level,
  opening: ZERO,
  closing: ZERO,
  movements: [move()],
});
const GROUPS = [
  groupOf('1', 'Comptes de ressources durables', 1),
  groupOf('10', 'Capital', 2),
  groupOf('4', 'Comptes de tiers', 1),
  groupOf('40', 'Fournisseurs et comptes rattachés', 2),
  groupOf('41', 'Clients et comptes rattachés', 2),
  groupOf('7', 'Comptes de produits des activités ordinaires', 1),
  groupOf('70', 'Ventes', 2),
];
const balance = (
  options: { periods?: object[]; rows?: unknown[]; warnings?: unknown[]; totals?: object } = {},
) => ({
  scope: {
    fiscal_year: { public_id: 'fy-2026', code: '2026' },
    period: null,
    date_from: '2026-10-01',
    date_to: '2026-10-31',
  },
  comparative_scope: null,
  periods: options.periods ?? [OCTOBER],
  totals: {
    opening: ZERO,
    debit: amount(99294000),
    credit: amount(99294000),
    closing: ZERO,
    ...options.totals,
  },
  movements: (options.periods ?? [OCTOBER]).map(() => move(99294000, 99294000)),
  groups: GROUPS,
  comparison: null,
  warnings: options.warnings ?? [],
  ...page(options.rows ?? ROWS),
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

describe('BalancePage (Analyse › Balance comptable, as Odoo’s)', () => {
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
          { path: 'balance', component: BalancePage },
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
    /** Journals and currencies, read once; then the balance asked. */
    const references = async () => {
      httpMock()
        .expectOne((req) => req.url === '/api/v1/accounting/journals/')
        .flush(page(JOURNALS));
      httpMock()
        .expectOne((req) => req.url === '/api/v1/currencies/')
        .flush(page([{ code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' }]));
      await stable();
      return httpMock().expectOne((req) => req.url === '/api/v1/reporting/balance/');
    };
    const asked = () => httpMock().expectOne((req) => req.url === '/api/v1/reporting/balance/');
    return { element, stable, references, asked, harness };
  }

  it('ce mois par défaut, la barre d’Odoo ; les soldes sur deux colonnes, débiteur et créditeur', async () => {
    const { element, stable, references } = await open('/balance');
    const request = await references();
    expect(request.request.params.get('date_from')).toBe('2026-10-01');
    expect(request.request.params.get('date_to')).toBe('2026-10-31');
    expect(request.request.params.has('column_from')).toBe(false);
    expect(request.request.params.get('page_size')).toBe('200');
    request.flush(balance());
    await stable();

    const bar = element.querySelector('.report-bar');
    expect(cells(bar, 'button').slice(0, 2)).toEqual(['PDF', 'XLSX']);
    expect(text(bar?.querySelector('h1'))).toBe('Balance comptable');
    expect(text(bar)).toContain('oct. 2026');
    expect(text(bar)).toContain('Comparaison');
    expect(text(bar)).toContain('Tous les journaux');
    expect(text(bar)).toContain('Pièces comptabilisées, Comptabilité d’engagement');
    expect(text(bar)).toContain('En GNF');
    expect(cells(element.querySelector('.heads'), 'th')).toEqual([
      'Solde initial',
      'oct. 2026',
      'Solde final',
    ]);
    // La balance à six colonnes : chaque solde en débiteur ou créditeur, les mouvements entre.
    expect(cells(element.querySelector('.subheads'), 'th')).toEqual([
      'Compte',
      'Débiteur',
      'Créditeur',
      'Débit',
      'Crédit',
      'Débiteur',
      'Créditeur',
    ]);
    const [capital, fournisseurs, clients, ventes] = [...element.querySelectorAll('tbody tr')];
    // Un solde positif est débiteur, l'autre colonne vide.
    expect(cells(clients)).toEqual(['8 000 000', '', '72 914 000', '0', '80 914 000', '']);
    expect(clients.querySelectorAll('td')[3].classList).toContain('zero');
    // Un solde négatif est créditeur, sans le signe moins.
    expect(text(capital.querySelector('th'))).toContain('101300 Capital souscrit');
    expect(cells(capital)).toEqual(['', '5 000 000', '0', '0', '', '5 000 000']);
    expect(cells(ventes)).toEqual(['', '', '0', '22 914 000', '', '22 914 000']);
    // Un solde nul : les deux colonnes vides.
    expect(cells(fournisseurs)).toEqual(['', '', '12 803 500', '12 803 500', '', '']);
    // Sans les totaux des soldes du serveur : la ligne Total les laisse vides et le dit.
    expect(cells(element.querySelector('tfoot'))).toEqual([
      '',
      '',
      '99 294 000',
      '99 294 000',
      '',
      '',
    ]);
    expect(text(element.querySelector('.totals-note'))).toContain('ne sont pas calculés ici');
  });

  it('les totaux des soldes débiteurs et créditeurs, quand le serveur les donne', async () => {
    const { element, stable, references } = await open('/balance');
    (await references()).flush(
      balance({
        totals: {
          opening_debit: amount(8000000),
          opening_credit: amount(5000000),
          closing_debit: amount(80914000),
          closing_credit: amount(27914000),
        },
      }),
    );
    await stable();
    expect(cells(element.querySelector('tfoot'))).toEqual([
      '8 000 000',
      '5 000 000',
      '99 294 000',
      '99 294 000',
      '80 914 000',
      '27 914 000',
    ]);
    expect(element.querySelector('.totals-note')).toBeNull();
  });

  it('the date menu, as Odoo’s: a month moved by ◀, then a quarter', async () => {
    const { element, stable, references, asked } = await open('/balance');
    (await references()).flush(balance());
    await stable();

    element.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.click();
    await stable();
    const panel = document.querySelector('[role="dialog"][aria-label="Période"]');
    expect(cells(panel, '.value')).toEqual(['octobre 2026', 'oct. - déc. 2026', '2026']);
    panel?.querySelector<HTMLButtonElement>('[aria-label="Mois précédent"]')?.click();
    await stable();
    const september = asked();
    expect(september.request.params.get('date_from')).toBe('2026-09-01');
    expect(september.request.params.get('date_to')).toBe('2026-09-30');
    september.flush(balance({ periods: [SEPTEMBER] }));
    await stable();
    expect(TestBed.inject(Router).url).toContain('date=2026-09-01');
    expect(text(element.querySelector('.report-bar'))).toContain('sept. 2026');

    const quarter = [...document.querySelectorAll<HTMLButtonElement>('.choice')].find(
      (button) => text(button) === 'Trimestre',
    );
    quarter?.click();
    await stable();
    const third = asked();
    expect([third.request.params.get('date_from'), third.request.params.get('date_to')]).toEqual([
      '2026-07-01',
      '2026-09-30',
    ]);
    third.flush(balance());
    await stable();
  });

  it('Comparaison: Période précédente, the earlier month in columns before this one', async () => {
    const { element, stable, references } = await open('/balance?comparaison=precedente&nombre=2');
    const request = await references();
    expect(request.request.params.getAll('column_from')).toEqual(['2026-08-01', '2026-09-01']);
    expect(request.request.params.getAll('column_to')).toEqual(['2026-08-31', '2026-09-30']);
    request.flush(
      balance({
        periods: [SEPTEMBER, OCTOBER],
        rows: [row('411100', 'Clients', 0, [move(8000000), move(72914000)], 80914000)],
      }),
    );
    await stable();

    expect(text(element.querySelector('.report-bar'))).toContain('Comparaison: Période précédente');
    expect(cells(element.querySelector('.heads'), 'th')).toEqual([
      'Solde initial',
      'sept. 2026',
      'oct. 2026',
      'Solde final',
    ]);
    // Solde initial nul (deux colonnes vides), deux périodes, solde final débiteur.
    expect(cells(element.querySelector('tbody tr'))).toEqual([
      '',
      '',
      '8 000 000',
      '0',
      '72 914 000',
      '0',
      '80 914 000',
      '',
    ]);
  });

  it('drafts left out: Odoo’s banner and its link; included by « Écritures brouillon »', async () => {
    const { element, stable, references } = await open('/balance');
    (await references()).flush(
      balance({ warnings: [{ code: 'unposted_entries', message: '', details: { count: 2 } }] }),
    );
    await stable();

    const banner = element.querySelector('.banner');
    expect(text(banner)).toBe(
      'Il y a des pièces non comptabilisées avant ou au cours de cette période.',
    );
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe(
      '/app/comptabilite/ecritures?etat=draft&au=2026-10-31',
    );
  });

  it('« Toutes les pièces » from the URL: the drafts asked too', async () => {
    const { element, stable, references } = await open('/balance?brouillons=oui&journal=VT&q=41');
    const request = await references();
    expect(request.request.params.get('include_unposted')).toBe('true');
    expect(request.request.params.getAll('journal')).toEqual(['j-VT']);
    expect(request.request.params.get('search')).toBe('41');
    request.flush(balance());
    await stable();
    expect(text(element.querySelector('.report-bar'))).toContain(
      'Toutes les pièces, Comptabilité d’engagement',
    );
  });

  it('« Hiérarchie et sous-totaux »: classes and groups with their sums, folded on a click', async () => {
    const { element, stable, references } = await open('/balance?hierarchie=oui');
    (await references()).flush(balance());
    await stable();

    const names = () =>
      cells(element.querySelector('tbody'), 'th').map((name) => name.split(' ')[0]);
    expect(names()).toEqual([
      '1',
      '10',
      '101300',
      '4',
      '40',
      '401100',
      '41',
      '411100',
      '7',
      '70',
      '701100',
    ]);
    const tiers = [...element.querySelectorAll<HTMLButtonElement>('button.fold')].find((button) =>
      text(button).startsWith('4 '),
    );
    tiers?.click();
    await stable();
    expect(names()).toEqual(['1', '10', '101300', '4', '7', '70', '701100']);
  });

  it('the ⋮ of an account opens its general ledger on the same dates', async () => {
    const { stable, references } = await open('/balance');
    (await references()).flush(balance());
    await stable();

    document.querySelector<HTMLButtonElement>('[aria-label="Actions du compte 411100"]')?.click();
    await stable();
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => text(item))).toEqual([
      'Grand livre général',
      'Écritures comptables',
    ]);
    (items[0] as HTMLElement).click();
    await stable();
    expect(TestBed.inject(Router).url).toBe(
      '/app/comptabilite/analyse/grand-livre?compte=411100&date=2026-10-22',
    );
  });

  it('PDF: the same balance asked as a PDF export, then saved', async () => {
    const createUrl = vi.fn(() => 'blob:balance');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const { element, stable, references } = await open(
      '/balance?comparaison=precedente&journal=AC',
    );
    (await references()).flush(balance({ periods: [SEPTEMBER, OCTOBER] }));
    await stable();

    element
      .querySelector<HTMLButtonElement>('[aria-label="Télécharger la balance en PDF"]')
      ?.click();
    await stable();
    const created = httpMock().expectOne('/api/v1/imports-exports/exports/');
    expect(created.request.body).toEqual({
      export_type: 'reporting.balance',
      file_format: 'pdf',
      parameters: {
        date_from: '2026-10-01',
        date_to: '2026-10-31',
        column_from: ['2026-09-01'],
        column_to: ['2026-09-30'],
        journal: ['j-AC'],
        include_unposted: false,
        search: '',
      },
      asynchronous: false,
    });
    created.flush({ public_id: 'x1', status: 'completed', filename: 'balance.pdf' });
    await stable();
    httpMock()
      .expectOne('/api/v1/imports-exports/exports/x1/download/')
      .flush(new Blob(['%PDF']), {
        headers: { 'Content-Disposition': 'attachment; filename="balance.pdf"' },
      });
    await stable();
    expect(createUrl).toHaveBeenCalled();
  });

  it('without the export permission, neither PDF nor XLSX', async () => {
    const { element, stable, references } = await open('/balance', [
      'accounting.read',
      'reporting.read',
    ]);
    (await references()).flush(balance());
    await stable();
    expect(text(element.querySelector('.report-bar'))).not.toContain('PDF');
    expect(text(element.querySelector('.report-bar'))).not.toContain('XLSX');
  });
});
