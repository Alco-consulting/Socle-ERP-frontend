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
import { DueItem, DueItemDetail, DueSchedule, PendingLine } from '../data-access/due-models';
import { DueItemDetailPage } from './due-item-detail';
import { DuePage } from './due-page';
import { DueScheduleDetailPage } from './due-schedule-detail';
import { RecomputeDialogService } from './recompute-dialog';

const BASE = '/app/comptabilite/echeances';
const READ = ['accounting.read'];
const MANAGER = ['accounting.read', 'accounting.manage_due_dates', 'audit.read'];
const GNF = { code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' };
const PARTNER = { public_id: 'p-1', code: 'CLI-001', name: 'Dupont SARL' };
const ENTRY = { public_id: 'e-1', entry_number: 'VTE-000101', entry_date: '2026-03-02' };

const page = <T>(results: readonly T[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const is =
  (path: string, method = 'GET') =>
  (req: { url: string; method: string }) =>
    req.url === `/api/v1/${path}` && req.method === method;
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');

function item(extra: Partial<DueItem> = {}): DueItem {
  return {
    public_id: 'd-1',
    schedule: 's-1',
    sequence: 1,
    due_date: '2026-04-01',
    percentage: '100.0000',
    partner: PARTNER,
    role: 'customer',
    account: { public_id: 'a-411', code: '411' },
    entry: ENTRY,
    line: 'l-1',
    currency: 'GNF',
    amount: '1000000.000000',
    settled_amount: '400000.000000',
    open_amount: '600000.000000',
    status: 'partial',
    last_settled_on: '2026-03-10',
    ...extra,
  };
}

function schedule(extra: Partial<DueSchedule> = {}): DueSchedule {
  return {
    public_id: 's-1',
    line: 'l-1',
    entry: ENTRY,
    partner: PARTNER,
    account: { public_id: 'a-411', code: '411' },
    role: 'customer',
    payment_term: { public_id: 't-1', code: 'NET30' },
    terms: {
      code: 'NET30',
      name: '30 jours',
      lines: [{ sequence: 1, percentage: '100.0000', days: 30, rule: 'net' }],
    },
    reference_date: '2026-03-02',
    currency: 'GNF',
    amount: '1000000.000000',
    created_at: '2026-10-04T10:00:00Z',
    recomputed_at: null,
    items: [
      {
        public_id: 'd-1',
        sequence: 1,
        due_date: '2026-04-01',
        percentage: '100.0000',
        amount: '1000000.000000',
        settled_amount: '400000.000000',
        open_amount: '600000.000000',
        status: 'partial',
        last_settled_on: '2026-03-10',
      },
    ],
    ...extra,
  };
}

const PENDING: PendingLine = {
  public_id: 'l-9',
  entry: { public_id: 'e-9', entry_number: 'VTE-000109', entry_date: '2026-03-09' },
  document_date: null,
  partner: PARTNER,
  account: { public_id: 'a-411', code: '411' },
  role: 'customer',
  label: 'Facture FAC-109',
  currency: 'GNF',
  amount: '500000.000000',
};

describe('Comptabilité › Échéances (V2.1 A5)', () => {
  async function open(url: string, permissions: readonly string[] = MANAGER) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'app/comptabilite/echeances',
            children: [
              { path: '', component: DuePage },
              { path: 'echeanciers/:id', component: DueScheduleDetailPage },
              { path: ':id', component: DueItemDetailPage },
            ],
          },
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
    const toasts = () =>
      TestBed.inject(AlcoToastService)
        .toasts()
        .map((toast) => toast.message);
    return { harness, element, stable, button, toasts };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  function currencies(): void {
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
  }

  it('lists the installments the server gives, with exact amounts and their state', async () => {
    const { element, stable } = await open(BASE, READ);
    currencies();
    await stable();
    const request = httpMock().expectOne(is('accounting/due-items/'));
    expect(request.request.params.get('page_size')).toBe('25');
    request.flush(page([item()]));
    await stable();
    const row = element().querySelector('.wide tbody tr')!;
    expect(text(row)).toContain('01/04/2026');
    expect(text(row)).toContain('CLI-001');
    expect(text(row)).toContain('VTE-000101');
    expect(text(row)).toContain('600 000');
    expect(text(row)).toContain('Partiellement réglée');
  });

  it('the URL’s filters go to the server; the partner code is found first', async () => {
    const { stable } = await open(
      `${BASE}?tiers=CLI-001&role=customer&etat=open&du=2026-04-01&au=2026-04-30&page=2`,
      READ,
    );
    currencies();
    const partner = httpMock().expectOne(is('partners/'));
    expect(partner.request.params.get('code')).toBe('CLI-001');
    partner.flush(page([PARTNER]));
    await stable();
    const params = httpMock().expectOne(is('accounting/due-items/')).request.params;
    expect(params.get('partner')).toBe('p-1');
    expect(params.get('role')).toBe('customer');
    expect(params.get('status')).toBe('open');
    expect(params.get('due_from')).toBe('2026-04-01');
    expect(params.get('due_to')).toBe('2026-04-30');
    expect(params.get('page')).toBe('2');
    httpMock().match(is('accounting/due-items/'))[0]?.flush(page([]));
  });

  it('a refusal of the server is said, without data', async () => {
    const { element, stable } = await open(BASE, READ);
    currencies();
    await stable();
    httpMock()
      .expectOne(is('accounting/due-items/'))
      .flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Vous n’avez pas accès aux échéances de cette société.');
  });

  // ---- Pending lines and generation -------------------------------------------------------

  async function pending(permissions: readonly string[] = MANAGER) {
    const view = await open(`${BASE}?vue=a-generer`, permissions);
    currencies();
    await view.stable();
    httpMock()
      .expectOne(is('accounting/due-schedules/pending-lines/'))
      .flush(page([PENDING]));
    await view.stable();
    return view;
  }

  it('the invoices to schedule; generating is the server’s command, confirmed', async () => {
    const view = await pending();
    expect(text(view.element())).toContain('VTE-000109');
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    view
      .element()
      .querySelector<HTMLInputElement>('.wide input[aria-label="Sélectionner VTE-000109 CLI-001"]')!
      .click();
    await view.stable();
    view.button('Générer les échéances')!.click();
    await view.stable();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Générer les échéances de cette facture ?' }),
    );
    const request = httpMock().expectOne(is('accounting/due-schedules/', 'POST'));
    expect(request.request.body).toEqual({ lines: ['l-9'] });
    request.flush([schedule({ public_id: 's-9', entry: PENDING.entry })]);
    await view.stable();
    expect(view.toasts()).toContain('Échéancier généré.');
    const generated = view.element().querySelector('.generated')!;
    expect(text(generated)).toContain('VTE-000109 · CLI-001');
    expect(text(generated)).toContain('1 échéance, condition NET30');
    expect(generated.querySelector('a')?.getAttribute('href')).toBe(`${BASE}/echeanciers/s-9`);
    httpMock().expectOne(is('accounting/due-schedules/pending-lines/')).flush(page([]));
    await view.stable();
  });

  it('a refused generation says why, from the server’s code and details', async () => {
    const view = await pending();
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    view.element().querySelector<HTMLInputElement>('.wide tbody input')!.click();
    await view.stable();
    view.button('Générer les échéances')!.click();
    await view.stable();
    httpMock()
      .expectOne(is('accounting/due-schedules/', 'POST'))
      .flush(
        {
          error: {
            code: 'accounting_due_payment_term_missing',
            message: 'x',
            details: { partner: 'CLI-001', role: 'customer' },
            correlation_id: 'c',
          },
        },
        { status: 400, statusText: 'x' },
      );
    await view.stable();
    expect(text(view.element())).toContain('Le tiers CLI-001 n’a pas de condition de paiement.');
  });

  it('without accounting.manage_due_dates nothing can be generated', async () => {
    const view = await pending(READ);
    expect(text(view.element())).toContain('consultation seule');
    expect(view.element().querySelector('input[type=checkbox]')).toBeNull();
    expect(view.button('Générer les échéances')).toBeUndefined();
  });

  // ---- Records ------------------------------------------------------------------------------

  it('an installment with its settlements and the lettering they came from', async () => {
    const { element, stable } = await open(`${BASE}/d-1`, READ);
    currencies();
    const detail: DueItemDetail = {
      ...item(),
      settlements: [
        {
          lettering: { public_id: 'let-1', reference: 'LET-000001' },
          amount: '400000.000000',
          settled_on: '2026-03-10',
        },
      ],
    };
    httpMock().expectOne(is('accounting/due-items/d-1/')).flush(detail);
    await stable();
    expect(text(element())).toContain('Échéance du 01/04/2026');
    expect(text(element())).toContain('Ouvert600 000 GNF');
    const lettering = element().querySelector<HTMLAnchorElement>('.rows a')!;
    expect(lettering.textContent?.trim()).toBe('LET-000001');
    expect(lettering.getAttribute('href')).toBe('/app/comptabilite/lettrage/let-1');
    const schedule = Array.from(element().querySelectorAll('a')).find((link) =>
      text(link).includes('Voir l’échéancier'),
    );
    expect(schedule?.getAttribute('href')).toBe(`${BASE}/echeanciers/s-1`);
  });

  it('a schedule: its term as computed, its installments, its history', async () => {
    const { element, stable } = await open(`${BASE}/echeanciers/s-1`);
    currencies();
    httpMock().expectOne(is('accounting/due-schedules/s-1/')).flush(schedule());
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/audit/objects/accounting.dueschedule/s-1/')
      .flush(page([]));
    await stable();
    expect(text(element())).toContain('Échéancier VTE-000101');
    expect(text(element())).toContain('NET30 — 30 jours');
    expect(text(element())).toContain('100.0000 % à 30 j');
    expect(text(element())).toContain('02/03/2026');
    expect(element().querySelectorAll('alco-table tbody tr')).toHaveLength(1);
  });

  it('recomputing is confirmed with a reason, by the command, then read again', async () => {
    const { element, stable, button, toasts } = await open(`${BASE}/echeanciers/s-1`);
    currencies();
    httpMock().expectOne(is('accounting/due-schedules/s-1/')).flush(schedule());
    await stable();
    httpMock()
      .expectOne((req) => req.url.includes('/audit/objects/accounting.dueschedule/'))
      .flush(page([]));
    const ask = vi
      .spyOn(TestBed.inject(RecomputeDialogService), 'ask')
      .mockResolvedValue({ reason: 'Conditions renégociées', reference_date: '2026-03-31' });
    button('Recalculer')!.click();
    await stable();
    expect(ask).toHaveBeenCalledWith('VTE-000101 · CLI-001', []);
    const request = httpMock().expectOne(is('accounting/due-schedules/s-1/recompute/', 'POST'));
    expect(request.request.body).toEqual({
      reason: 'Conditions renégociées',
      reference_date: '2026-03-31',
    });
    request.flush(schedule({ recomputed_at: '2026-10-04T11:00:00Z' }));
    await stable();
    expect(toasts()).toContain('Échéancier recalculé.');
    httpMock()
      .expectOne(is('accounting/due-schedules/s-1/'))
      .flush(schedule({ recomputed_at: '2026-10-04T11:00:00Z' }));
    httpMock()
      .expectOne((req) => req.url.includes('/audit/objects/accounting.dueschedule/'))
      .flush(page([]));
    await stable();
    expect(text(element())).toContain('Dernier recalcul');
  });

  it('without accounting.manage_due_dates, no Recalculer', async () => {
    const { button, stable } = await open(`${BASE}/echeanciers/s-1`, READ);
    currencies();
    httpMock().expectOne(is('accounting/due-schedules/s-1/')).flush(schedule());
    await stable();
    expect(button('Recalculer')).toBeUndefined();
  });

  it('after a company change, the due dates list without record nor filters', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    openTestSession(TestBed.inject(SessionStore), { permissions: READ });
    const navigation = TestBed.inject(NavigationService);
    expect(navigation.landingUrl(`${BASE}/d-1`)).toBe(BASE);
    expect(navigation.landingUrl(`${BASE}/echeanciers/s-1`)).toBe(BASE);
    expect(navigation.canOpenUrl(BASE)).toBe(true);
  });
});
