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
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AgedBalance, AgedPartner, AgingBucket } from '../data-access/aging-models';
import { AgedBalancePage } from './aged-balance-page';
import { AgedPartnerPage } from './aged-partner-page';
import { AgingPolicyPage } from './aging-policy-page';

const CUSTOMERS = '/app/comptabilite/analyse/balance-clients';
const SUPPLIERS = '/app/comptabilite/analyse/balance-fournisseurs';
const POLICY = '/app/comptabilite/configuration/balance-agee';
const READ = ['accounting.read', 'reporting.read_auxiliary'];
const GNF = { code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' };
const PARTNER = { public_id: 'p-1', code: 'CLI-001', name: 'Dupont SARL' };

const DEFAULT: readonly AgingBucket[] = [
  { code: 'not_due', first_day: null, last_day: 0 },
  { code: '1-30', first_day: 1, last_day: 30 },
  { code: '31-60', first_day: 31, last_day: 60 },
  { code: '61-90', first_day: 61, last_day: 90 },
  { code: '91-120', first_day: 91, last_day: 120 },
  { code: '121+', first_day: 121, last_day: null },
];
const OWN: readonly AgingBucket[] = [
  { code: 'not_due', first_day: null, last_day: 0 },
  { code: '1-15', first_day: 1, last_day: 15 },
  { code: '16-45', first_day: 16, last_day: 45 },
  { code: '46+', first_day: 46, last_day: null },
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const is =
  (path: string, method = 'GET') =>
  (req: { url: string; method: string }) =>
    req.url === `/api/v1/${path}` && req.method === method;
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');
const amounts = (buckets: readonly AgingBucket[], values: Record<string, string>) =>
  buckets.map((bucket) => ({ code: bucket.code, amount: values[bucket.code] ?? '0.000000' }));

function balance(buckets: readonly AgingBucket[] = DEFAULT): AgedBalance {
  const row = amounts(buckets, { '31-60': '600000.000000', not_due: '200000.000000' });
  return {
    as_of: '2026-04-15',
    role: 'customer',
    currency: 'GNF',
    buckets,
    totals: {
      buckets: row,
      total: '800000.000000',
      unscheduled: '300000.000000',
      unapplied: '50000.000000',
      balance: '1050000.000000',
    },
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        partner: PARTNER,
        oldest_due_date: '2026-03-01',
        buckets: row,
        total: '800000.000000',
        unscheduled: '300000.000000',
        unapplied: '50000.000000',
        balance: '1050000.000000',
      },
    ],
  };
}

function partnerReport(): AgedPartner {
  const report = balance();
  return {
    ...report,
    partner: PARTNER,
    bucket: null,
    count: 3,
    results: [
      {
        kind: 'unapplied',
        due_item: null,
        schedule: null,
        line: 'l-3',
        entry: { public_id: 'e-3', entry_number: 'BQ1-000003', entry_date: '2026-03-03' },
        account: '411',
        document_reference: '',
        label: 'Acompte',
        due_date: null,
        days_past_due: null,
        bucket: null,
        amount: '50000.000000',
        open_amount: '50000.000000',
      },
      {
        kind: 'installment',
        due_item: 'd-1',
        schedule: 's-1',
        line: 'l-1',
        entry: { public_id: 'e-1', entry_number: 'VTE-000101', entry_date: '2026-02-01' },
        account: '411',
        document_reference: 'FAC-101',
        label: 'Facture',
        due_date: '2026-03-01',
        days_past_due: 45,
        bucket: '31-60',
        amount: '1000000.000000',
        open_amount: '600000.000000',
      },
      {
        kind: 'unscheduled',
        due_item: null,
        schedule: null,
        line: 'l-2',
        entry: { public_id: 'e-2', entry_number: 'VTE-000102', entry_date: '2026-03-20' },
        account: '411',
        document_reference: 'FAC-102',
        label: 'Facture',
        due_date: null,
        days_past_due: null,
        bucket: null,
        amount: '300000.000000',
        open_amount: '300000.000000',
      },
    ],
  };
}

describe('Analyse › Balance âgée (V2.1 A5)', () => {
  async function open(url: string, permissions: readonly string[] = READ) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'app/comptabilite/analyse/balance-clients',
            data: { aging: 'customer' },
            children: [
              { path: '', component: AgedBalancePage },
              { path: ':id', component: AgedPartnerPage },
            ],
          },
          {
            path: 'app/comptabilite/analyse/balance-fournisseurs',
            data: { aging: 'supplier' },
            children: [{ path: '', component: AgedBalancePage }],
          },
          { path: 'app/comptabilite/configuration/balance-agee', component: AgingPolicyPage },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = () => harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
      await settle();
    };
    const button = (label: string) =>
      Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find((found) =>
        text(found).includes(label),
      );
    return { harness, element, stable, button };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  function currencies(): void {
    httpMock()
      .expectOne(is('currencies/'))
      .flush({ count: 1, next: null, previous: null, results: [GNF] });
  }

  it('asks nothing before the reference date is confirmed, then the customers’ report', async () => {
    const { element, stable, button } = await open(CUSTOMERS);
    currencies();
    await stable();
    httpMock().expectNone(is('reporting/aged-balance/'));
    expect(text(element())).toContain('Choisissez la date de référence.');
    const field = element().querySelector<HTMLInputElement>('input[type=date]')!;
    expect(element().querySelector(`label[for="${field.id}"]`)?.textContent).toContain(
      'Date de référence',
    );
    field.value = '2026-04-15';
    field.dispatchEvent(new Event('input'));
    button('Afficher la balance')!.click();
    await stable();
    const request = httpMock().expectOne(is('reporting/aged-balance/'));
    expect(request.request.params.get('role')).toBe('customer');
    expect(request.request.params.get('as_of')).toBe('2026-04-15');
    request.flush(balance());
    await stable();
    const summary = element().querySelector('alco-aged-summary')!;
    expect(text(summary)).toContain('Situation au 15/04/2026');
    expect(text(summary)).toContain('Devise : GNF');
    expect(text(summary)).toContain('31–60 j600 000');
    expect(text(summary)).toContain('Factures sans échéancier300 000');
    expect(text(summary)).toContain('Non affecté (règlements, avoirs)50 000');
    expect(text(summary)).toContain('Solde1 050 000 GNF');
  });

  it('the suppliers’ report asks the supplier role', async () => {
    const { stable } = await open(`${SUPPLIERS}?au=2026-04-15`);
    currencies();
    await stable();
    const request = httpMock().expectOne(is('reporting/aged-balance/'));
    expect(request.request.params.get('role')).toBe('supplier');
    request.flush({ ...balance(), role: 'supplier', count: 0, results: [] });
    await stable();
  });

  it('the buckets are the API’s: another policy gives other columns', async () => {
    const { element, stable } = await open(`${CUSTOMERS}?au=2026-04-15`);
    currencies();
    await stable();
    httpMock().expectOne(is('reporting/aged-balance/')).flush(balance(OWN));
    await stable();
    const headers = Array.from(element().querySelectorAll('.wide thead th')).map((cell) =>
      text(cell).trim(),
    );
    expect(headers).toEqual([
      'Tiers',
      'Non échue',
      '1–15 j',
      '16–45 j',
      'Plus de 45 j',
      'Total',
      'Solde',
    ]);
  });

  it('drill-down: a partner, or one of its buckets, keeps the reference date', async () => {
    const { element, stable } = await open(`${CUSTOMERS}?au=2026-04-15`);
    currencies();
    await stable();
    httpMock().expectOne(is('reporting/aged-balance/')).flush(balance());
    await stable();
    const links = Array.from(element().querySelectorAll<HTMLAnchorElement>('.wide tbody a'));
    expect(links[0].getAttribute('href')).toBe(`${CUSTOMERS}/p-1?au=2026-04-15`);
    const bucket = links.find((link) => link.getAttribute('href')?.includes('tranche=31-60'))!;
    expect(bucket.getAttribute('aria-label')).toBe('CLI-001, de 31 à 60 jours de retard : 600 000');
  });

  it('a partner’s documents lead to the installment and the entry', async () => {
    const { element, stable } = await open(`${CUSTOMERS}/p-1?au=2026-04-15`);
    currencies();
    const request = httpMock().expectOne(is('reporting/aged-balance/partners/p-1/'));
    expect(request.request.params.get('as_of')).toBe('2026-04-15');
    expect(request.request.params.get('role')).toBe('customer');
    request.flush(partnerReport());
    await stable();
    const rows = Array.from(element().querySelectorAll('.wide tbody tr'));
    expect(rows.map((row) => text(row.querySelector('td')!).trim())).toEqual([
      'Règlement ou avoir non affecté',
      'Échéance 31–60 j',
      'Facture sans échéancier',
    ]);
    const hrefs = Array.from(rows[1].querySelectorAll('a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/app/comptabilite/ecritures/e-1', '/app/comptabilite/echeances/d-1']);
    expect(text(rows[1])).toContain('45 j');
    expect(rows[2].querySelector('a[href*="vue=a-generer"]')?.textContent?.trim()).toBe(
      'À générer',
    );
  });

  /** The server's page of one bucket: `count` documents, `size` of them on this page. */
  function bucketPage(count: number, size: number, page = 1): AgedPartner {
    const base = partnerReport();
    const installment = base.results[1];
    return {
      ...base,
      bucket: DEFAULT[2],
      count,
      next: page * size < count ? 'next' : null,
      results: Array.from({ length: size }, (_, index) => ({
        ...installment,
        due_item: `d-${page}-${index}`,
        line: `l-${page}-${index}`,
      })),
    };
  }

  it('one bucket of a partner: the server’s complete list, paged by the server', async () => {
    const { element, stable, harness } = await open(`${CUSTOMERS}/p-1?au=2026-04-15&tranche=31-60`);
    currencies();
    const first = httpMock().expectOne(is('reporting/aged-balance/partners/p-1/'));
    expect(first.request.params.get('bucket')).toBe('31-60');
    expect(first.request.params.get('page')).toBeNull();
    first.flush(bucketPage(500, 200));
    await stable();
    // Every row of the page is shown: nothing filtered here.
    expect(element().querySelectorAll('.wide tbody tr')).toHaveLength(200);
    expect(text(element())).toContain('Tranche 31–60 j : 500 échéances');
    expect(element().querySelector('.bucket-nav [aria-current="page"]')?.textContent?.trim()).toBe(
      '31–60 j',
    );

    // The next pages come from the server, with the same bucket.
    await harness.navigateByUrl(`${CUSTOMERS}/p-1?au=2026-04-15&tranche=31-60&page=3`);
    const third = httpMock().expectOne(is('reporting/aged-balance/partners/p-1/'));
    expect(third.request.params.get('bucket')).toBe('31-60');
    expect(third.request.params.get('page')).toBe('3');
    third.flush(bucketPage(500, 100, 3));
    await stable();
    expect(element().querySelectorAll('.wide tbody tr')).toHaveLength(100);
  }, 30_000); // 200 rows rendered twice (table and cards) by jsdom

  it('another bucket, another partner, another date: each a new request of the server', async () => {
    const { element, stable, harness } = await open(
      `${CUSTOMERS}/p-1?au=2026-04-15&tranche=31-60&page=2`,
    );
    currencies();
    httpMock()
      .expectOne(is('reporting/aged-balance/partners/p-1/'))
      .flush(bucketPage(500, 20, 2));
    await stable();
    const link = Array.from(element().querySelectorAll<HTMLAnchorElement>('.bucket-nav a')).find(
      (item) => item.textContent?.trim() === '1–30 j',
    )!;
    expect(link.getAttribute('href')).toBe(`${CUSTOMERS}/p-1?au=2026-04-15&tranche=1-30`);
    link.click();
    await stable();
    const other = httpMock().expectOne(is('reporting/aged-balance/partners/p-1/'));
    expect(other.request.params.get('bucket')).toBe('1-30');
    expect(other.request.params.get('page')).toBeNull();
    other.flush({ ...bucketPage(0, 0), bucket: DEFAULT[1] });
    await stable();
    expect(text(element())).toContain('Aucune échéance dans cette tranche.');

    await harness.navigateByUrl(`${CUSTOMERS}/p-2?au=2026-05-31&tranche=31-60`);
    const next = httpMock().expectOne(is('reporting/aged-balance/partners/p-2/'));
    expect(next.request.params.get('as_of')).toBe('2026-05-31');
    expect(next.request.params.get('bucket')).toBe('31-60');
    next.flush(bucketPage(3, 3));
    await stable();
    const all = element().querySelector<HTMLAnchorElement>('.bucket-nav a')!;
    expect(all.getAttribute('href')).toBe(`${CUSTOMERS}/p-2?au=2026-05-31`);
  });

  it('a bucket the policy no longer has: the server’s refusal, said by its code', async () => {
    const { element, stable } = await open(`${CUSTOMERS}/p-1?au=2026-04-15&tranche=31-60`);
    currencies();
    httpMock()
      .expectOne(is('reporting/aged-balance/partners/p-1/'))
      .flush(envelope('reporting_aging_bucket_unknown'), { status: 400, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Cette tranche n’existe plus.');
  });

  it('without the auxiliary permission the server’s refusal is said', async () => {
    const { element, stable } = await open(`${CUSTOMERS}?au=2026-04-15`, ['accounting.read']);
    currencies();
    await stable();
    httpMock()
      .expectOne(is('reporting/aged-balance/'))
      .flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Vous n’avez pas accès aux états de tiers');
  });

  it('the screens follow the permissions; a company change lands on the report', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    openTestSession(TestBed.inject(SessionStore), { permissions: ['accounting.read'] });
    expect(TestBed.inject(NavigationService).canOpenUrl(CUSTOMERS)).toBe(false);
    openTestSession(TestBed.inject(SessionStore), { permissions: READ });
    const navigation = TestBed.inject(NavigationService);
    expect(navigation.canOpenUrl(CUSTOMERS)).toBe(true);
    expect(navigation.canOpenUrl(POLICY)).toBe(true);
    expect(navigation.landingUrl(`${CUSTOMERS}/p-1`)).toBe(CUSTOMERS);
  });

  // ---- The company's buckets ----------------------------------------------------------------

  it('the buckets are read; their limits are changed, confirmed, by the server', async () => {
    const { element, stable, button } = await open(POLICY, [...READ, 'reporting.manage_aging']);
    httpMock()
      .expectOne(is('reporting/aging-policy/'))
      .flush({ limits: [30, 60, 90, 120], default: true, buckets: DEFAULT });
    await stable();
    expect(text(element())).toContain('Tranches par défaut d’Alco');
    const inputs = () =>
      Array.from(element().querySelectorAll<HTMLInputElement>('ol.limits input'));
    expect(inputs().map((input) => input.value)).toEqual(['30', '60', '90', '120']);
    button('Retirer la limite 4')!.click();
    button('Retirer la limite 3')!.click();
    await stable();
    inputs()[0].value = '15';
    inputs()[0].dispatchEvent(new Event('input'));
    inputs()[1].value = '45';
    inputs()[1].dispatchEvent(new Event('input'));
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    button('Enregistrer les tranches')!.click();
    await stable();
    expect(confirm).toHaveBeenCalled();
    const request = httpMock().expectOne(is('reporting/aging-policy/', 'PUT'));
    expect(request.request.body).toEqual({ limits: [15, 45] });
    request.flush({ limits: [15, 45], default: false, buckets: OWN });
    await stable();
    expect(
      TestBed.inject(AlcoToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toContain('Tranches enregistrées.');
    expect(text(element())).toContain('Tranches propres à la société.');
    expect(text(element())).toContain('16–45 j');
  });

  it('invalid limits are refused by the server, with its message', async () => {
    const { element, stable, button } = await open(POLICY, [...READ, 'reporting.manage_aging']);
    httpMock()
      .expectOne(is('reporting/aging-policy/'))
      .flush({ limits: [30], default: false, buckets: DEFAULT.slice(0, 3) });
    await stable();
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    button('Enregistrer les tranches')!.click();
    await stable();
    httpMock()
      .expectOne(is('reporting/aging-policy/', 'PUT'))
      .flush(envelope('reporting_aging_policy_invalid'), { status: 400, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Ces tranches ne sont pas valides.');
  });

  it('without reporting.manage_aging the buckets are read only', async () => {
    const { element, stable, button } = await open(POLICY);
    httpMock()
      .expectOne(is('reporting/aging-policy/'))
      .flush({ limits: [30, 60, 90, 120], default: true, buckets: DEFAULT });
    await stable();
    expect(button('Enregistrer les tranches')).toBeUndefined();
    expect(text(element())).toContain('Votre profil permet de consulter les tranches');
  });
});
