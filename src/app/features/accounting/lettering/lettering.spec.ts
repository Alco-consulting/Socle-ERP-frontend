import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { toUserError } from '../../../core/errors/user-error';
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
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AccountDetailPage } from '../accounts/account-detail';
import { LetterableLine, Lettering, LetteringPreview } from '../data-access/lettering-models';
import { LetteringDetailPage } from './lettering-detail';
import { LetteringPage } from './lettering-page';
import { LETTERING_ERRORS } from './lettering-presentation';
import { UnletterDialogService } from './unletter-dialog';

const BASE = '/app/comptabilite/lettrage';
const READ = ['accounting.read'];
const LETTERER = ['accounting.read', 'accounting.letter'];
const ALL = ['accounting.read', 'accounting.letter', 'accounting.unletter', 'audit.read'];
const GNF = { code: 'GNF', name: 'Franc guinéen', decimal_places: 0, status: 'active' };
const ACCOUNT = { public_id: 'a-411', code: '411100' };
const PARTNER = { public_id: 'p-1', code: 'CLI-001' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

function line(
  id: string,
  side: 'debit' | 'credit',
  amount: string,
  extra: Partial<LetterableLine> = {},
): LetterableLine {
  return {
    public_id: id,
    entry: { public_id: `e-${id}`, entry_number: side === 'debit' ? 'VTE-000001' : 'BQ1-000001' },
    entry_date: '2026-09-02',
    journal: side === 'debit' ? 'VTE' : 'BQ1',
    document_reference: 'FAC-1',
    account: ACCOUNT,
    partner: PARTNER,
    label: side === 'debit' ? 'Facture' : 'Règlement',
    side,
    currency: 'GNF',
    amount: `${amount}.000000`,
    lettered_amount: '0.000000',
    open_amount: `${amount}.000000`,
    status: 'open',
    ...extra,
  };
}

const INVOICE = line('l-inv', 'debit', '1200');
const PAYMENT = line('l-pay', 'credit', '1000');

function preview(partial: boolean): LetteringPreview {
  return {
    account: ACCOUNT,
    partner: PARTNER,
    debit_total: '1200.000000',
    credit_total: '1000.000000',
    amount: '1000.000000',
    balanced: !partial,
    partial,
    rows: [
      {
        line: 'l-inv',
        entry: INVOICE.entry,
        side: 'debit',
        open_amount: '1200.000000',
        amount: '1000.000000',
        residual: '200.000000',
      },
      {
        line: 'l-pay',
        entry: PAYMENT.entry,
        side: 'credit',
        open_amount: '1000.000000',
        amount: '1000.000000',
        residual: '0.000000',
      },
    ],
  };
}

function lettering(extra: Partial<Lettering> = {}): Lettering {
  return {
    public_id: 'let-1',
    reference: 'LET-000001',
    kind: 'manual',
    status: 'active',
    account: ACCOUNT,
    partner: PARTNER,
    currency: 'GNF',
    amount: '1000.000000',
    partial: false,
    created_by: 'u-1',
    created_at: '2026-10-04T10:00:00Z',
    cancelled_by: null,
    cancelled_at: null,
    cancellation_reason: '',
    items: [
      {
        line: 'l-inv',
        entry: INVOICE.entry,
        entry_date: '2026-09-02',
        side: 'debit',
        amount: '1000.000000',
      },
      {
        line: 'l-pay',
        entry: PAYMENT.entry,
        entry_date: '2026-09-02',
        side: 'credit',
        amount: '1000.000000',
      },
    ],
    ...extra,
  };
}

describe('Comptabilité › Lettrage (V2.1 A4)', () => {
  async function open(url: string, permissions: readonly string[] = ALL) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'app/comptabilite/lettrage',
            children: [
              { path: '', component: LetteringPage },
              { path: ':id', component: LetteringDetailPage },
            ],
          },
          { path: 'app/comptabilite/plan-comptable/:id', component: AccountDetailPage },
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
    const toasts = () =>
      TestBed.inject(AlcoToastService)
        .toasts()
        .map((toast) => toast.message);
    const button = (label: string) =>
      Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find((item) =>
        text(item).includes(label),
      );
    /** The table's checkbox of a line (the cards repeat it for phones). */
    const pick = (lineName: string) =>
      element().querySelector<HTMLInputElement>(
        `.wide input[aria-label="Sélectionner ${lineName}"]`,
      );
    return { harness, element, stable, toasts, button, pick };
  }

  afterEach(() => {
    // Side requests of the account record (its journals and taxes named by their codes).
    for (const request of httpMock().match(
      (req) => req.url.endsWith('/accounting/journals/') || req.url.endsWith('/taxes/'),
    )) {
      request.flush({ count: 0, next: null, previous: null, results: [] });
    }
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  /** The page's first requests: currencies, then the open lines. */
  async function lines(
    stable: () => Promise<void>,
    results: readonly LetterableLine[] = [INVOICE, PAYMENT],
  ) {
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    await stable();
    const request = httpMock().expectOne(is('accounting/letterable-lines/'));
    request.flush(page(results));
    await stable();
    return request;
  }

  async function selectBoth(view: Awaited<ReturnType<typeof open>>) {
    view.pick('VTE-000001 Facture')!.click();
    view.pick('BQ1-000001 Règlement')!.click();
    await view.stable();
  }

  // ---- Access ------------------------------------------------------------------------------

  it('without accounting.read the screen is not offered; with it, it is', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    openTestSession(TestBed.inject(SessionStore), { permissions: ['partners.read'] });
    expect(TestBed.inject(NavigationService).canOpenUrl(BASE)).toBe(false);
    openTestSession(TestBed.inject(SessionStore), { permissions: READ });
    expect(TestBed.inject(NavigationService).canOpenUrl(BASE)).toBe(true);
  });

  it('a refusal of the server is said, without data', async () => {
    const { element, stable } = await open(BASE, READ);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    await stable();
    httpMock()
      .expectOne(is('accounting/letterable-lines/'))
      .flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
    await stable();
    expect(text(element())).toContain('Vous n’avez pas accès au lettrage de cette société.');
  });

  it('accounting.read only: the lines are read, nothing can be selected nor lettered', async () => {
    const { element, stable } = await open(BASE, READ);
    const request = await lines(stable);
    expect(request.request.params.get('status')).toBe('open');
    expect(request.request.params.get('page_size')).toBe('25');
    expect(text(element())).toContain('VTE-000001');
    expect(text(element())).toContain('consultation seule');
    expect(element().querySelector('input[type=checkbox]')).toBeNull();
    expect(element().querySelector('.selection-bar')).toBeNull();
  });

  it('the URL’s filters go to the server; the account and partner codes are found first', async () => {
    const { stable } = await open(
      `${BASE}?compte=411100&tiers=CLI-001&du=2026-09-01&au=2026-09-30&etat=lettered&page=2`,
    );
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    const account = httpMock().expectOne(is('accounting/accounts/'));
    expect(account.request.params.get('code')).toBe('411100');
    account.flush(page([ACCOUNT]));
    const partner = httpMock().expectOne(is('partners/'));
    expect(partner.request.params.get('code')).toBe('CLI-001');
    partner.flush(page([PARTNER]));
    await stable();
    const list = httpMock().expectOne(is('accounting/letterable-lines/'));
    const params = list.request.params;
    expect(params.get('account')).toBe('a-411');
    expect(params.get('partner')).toBe('p-1');
    expect(params.get('date_from')).toBe('2026-09-01');
    expect(params.get('date_to')).toBe('2026-09-30');
    expect(params.get('status')).toBe('lettered');
    expect(params.get('page')).toBe('2');
    list.flush(page([], 0));
    await stable();
  });

  it('an unknown account code is said; nothing is listed', async () => {
    const { element, stable } = await open(`${BASE}?compte=999`);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock().expectOne(is('accounting/accounts/')).flush(page([]));
    await stable();
    httpMock().expectNone(is('accounting/letterable-lines/'));
    expect(text(element())).toContain('Aucun compte de cette société n’a le code « 999 ».');
  });

  // ---- Selection and preview -----------------------------------------------------------

  it('selection: the open amounts of each side and their difference, as a reading aid', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    const bar = view.element().querySelector('.selection-bar')!;
    expect(text(bar)).toContain('2 lignes');
    expect(text(bar.querySelector('[role=status]')!)).toBe(
      '2 lignes sélectionnées. Ouvert au débit 1 200 GNF, au crédit 1 000 GNF, écart 200 GNF.',
    );
    view.button('Vider la sélection')!.click();
    await view.stable();
    expect(text(bar.querySelector('[role=status]')!)).toBe('Aucune ligne sélectionnée.');
  });

  it('a selection the server refuses is said with its message, by its code', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    view.pick('VTE-000001 Facture')!.click();
    await view.stable();
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    const request = httpMock().expectOne(is('accounting/letterings/preview/', 'POST'));
    expect(request.request.body).toEqual({ lines: ['l-inv'], allow_partial: false });
    request.flush(envelope('accounting_lettering_selection_invalid'), {
      status: 400,
      statusText: 'x',
    });
    await view.stable();
    expect(text(view.element())).toContain('La sélection ne permet pas un lettrage.');
    expect(text(view.element())).not.toContain('Server message.');
  });

  it('preview: the server’s result, nothing written', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    const request = httpMock().expectOne(is('accounting/letterings/preview/', 'POST'));
    expect(request.request.body).toEqual({ lines: ['l-inv', 'l-pay'], allow_partial: false });
    request.flush({ ...preview(false), credit_total: '1200.000000', amount: '1200.000000' });
    await view.stable();
    const panel = view.element().querySelector('.preview')!;
    expect(text(panel)).toContain('Lettrage complet');
    expect(text(panel.querySelector('.figure--key dd')!)).toBe('1 200 GNF');
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(document.activeElement?.id).toBe('lettering-preview-title');
    httpMock().expectNone(is('accounting/letterings/', 'POST'));
  });

  // ---- Lettering ------------------------------------------------------------------------

  it('manual lettering: the previewed lines with a key, then the server’s lines again', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    httpMock()
      .expectOne(is('accounting/letterings/preview/', 'POST'))
      .flush({ ...preview(false), credit_total: '1200.000000', amount: '1200.000000' });
    await view.stable();
    view.button('Confirmer le lettrage')!.click();
    await view.stable();
    const request = httpMock().expectOne(is('accounting/letterings/', 'POST'));
    expect(request.request.body).toEqual({
      lines: ['l-inv', 'l-pay'],
      allow_partial: false,
      idempotency_key: expect.stringMatching(UUID),
    });
    expect(request.request.body.write_off).toBeUndefined();
    request.flush(lettering());
    await view.stable();
    expect(view.toasts()).toContain('Lettrage LET-000001 créé.');
    httpMock()
      .expectOne(is('accounting/letterable-lines/'))
      .flush(page([line('l-pay2', 'credit', '1200')]));
    await view.stable();
    expect(view.element().querySelector('.preview')).toBeNull();
    expect(text(view.element().querySelector('[role=status]')!)).toBe('Aucune ligne sélectionnée.');
  });

  it('accounting_lettering_unbalanced: the exact figures, and a partial lettering on request', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    httpMock()
      .expectOne(is('accounting/letterings/preview/', 'POST'))
      .flush(
        {
          error: {
            code: 'accounting_lettering_unbalanced',
            message: 'x',
            details: { debit: '1200.000000', credit: '1000.000000', difference: '200.000000' },
            correlation_id: 'c',
          },
        },
        { status: 400, statusText: 'x' },
      );
    await view.stable();
    const panel = view.element().querySelector('.preview')!;
    expect(text(panel)).toContain('Le débit et le crédit sélectionnés ne sont pas égaux.');
    expect(text(panel)).toContain('Écart200 GNF');

    // Lettrage partiel: asked explicitly, the residual is the server's.
    view.button('Prévisualiser un lettrage partiel')!.click();
    await view.stable();
    const partial = httpMock().expectOne(is('accounting/letterings/preview/', 'POST'));
    expect(partial.request.body).toEqual({ lines: ['l-inv', 'l-pay'], allow_partial: true });
    partial.flush(preview(true));
    await view.stable();
    expect(text(view.element().querySelector('.preview')!)).toContain(
      'Lettrage partiel : un résiduel restera ouvert',
    );
    expect(text(view.element().querySelector('.residual')!).trim()).toBe('200');
    view.button('Confirmer le lettrage')!.click();
    await view.stable();
    const created = httpMock().expectOne(is('accounting/letterings/', 'POST'));
    expect(created.request.body.allow_partial).toBe(true);
    created.flush(lettering({ partial: true }));
    await view.stable();
    expect(view.toasts()).toContain('Lettrage LET-000001 créé. Le résiduel reste ouvert.');
    httpMock().expectOne(is('accounting/letterable-lines/')).flush(page([]));
    await view.stable();
  });

  it('a double click letters once', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    httpMock().expectOne(is('accounting/letterings/preview/', 'POST')).flush(preview(false));
    await view.stable();
    const confirm = view.button('Confirmer le lettrage')!;
    confirm.click();
    confirm.click();
    await view.stable();
    const requests = httpMock().match(is('accounting/letterings/', 'POST'));
    expect(requests).toHaveLength(1);
    requests[0].flush(lettering());
    await view.stable();
    httpMock().expectOne(is('accounting/letterable-lines/')).flush(page([]));
    await view.stable();
  });

  it('idempotency_key: the same key when retried; a repeat already made is not made again', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    httpMock().expectOne(is('accounting/letterings/preview/', 'POST')).flush(preview(false));
    await view.stable();
    view.button('Confirmer le lettrage')!.click();
    await view.stable();
    const first = httpMock().expectOne(is('accounting/letterings/', 'POST'));
    const key = first.request.body.idempotency_key as string;
    first.error(new ProgressEvent('error'), { status: 0, statusText: '' });
    await view.stable();
    expect(text(view.element())).toContain('Le serveur ne répond pas.');

    view.button('Confirmer le lettrage')!.click();
    await view.stable();
    const again = httpMock().expectOne(is('accounting/letterings/', 'POST'));
    expect(again.request.body.idempotency_key).toBe(key);
    again.flush(
      {
        error: {
          code: 'accounting_lettering_exists',
          message: 'x',
          details: { lettering: 'let-1' },
          correlation_id: 'c',
        },
      },
      { status: 400, statusText: 'x' },
    );
    await view.stable();
    expect(view.toasts()).toContain(
      'Ce lettrage était déjà enregistré : rien n’a été créé une seconde fois.',
    );
    httpMock().expectOne(is('accounting/letterable-lines/')).flush(page([]));
    await view.stable();
  });

  it('a line lettered in between: the server’s error, the lines read again, no stale selection', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    httpMock().expectOne(is('accounting/letterings/preview/', 'POST')).flush(preview(false));
    await view.stable();
    view.button('Confirmer le lettrage')!.click();
    await view.stable();
    httpMock()
      .expectOne(is('accounting/letterings/', 'POST'))
      .flush(envelope('accounting_lettering_line_lettered'), { status: 400, statusText: 'x' });
    await view.stable();
    expect(text(view.element())).toContain('Une ligne sélectionnée est déjà lettrée.');
    httpMock()
      .expectOne(is('accounting/letterable-lines/'))
      .flush(page([PAYMENT]));
    await view.stable();
    expect(view.element().querySelector('.preview')).toBeNull();
    expect(text(view.element().querySelector('[role=status]')!)).toBe('Aucune ligne sélectionnée.');
  });

  it('accounting_account_not_letterable is said by its code', async () => {
    const view = await open(BASE, LETTERER);
    await lines(view.stable);
    await selectBoth(view);
    view.button('Aperçu du lettrage')!.click();
    await view.stable();
    httpMock()
      .expectOne(is('accounting/letterings/preview/', 'POST'))
      .flush(envelope('accounting_account_not_letterable'), { status: 400, statusText: 'x' });
    await view.stable();
    expect(text(view.element())).toContain('Ce compte n’est pas lettrable.');
  });

  it('write-off: never asked; the server’s refusal has its own message', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    const error = toUserError(
      envelope('accounting_lettering_write_off_unavailable'),
      LETTERING_ERRORS,
    );
    expect(error.title).toBe('Le passage d’un écart en perte ou profit n’est pas disponible.');
    expect(error.code).toBe('accounting_lettering_write_off_unavailable');
    expect(LETTERING_ERRORS['accounting_lettering_unbalanced'].help).toContain(
      'jamais passé en perte ou profit',
    );
  });

  // ---- Proposals --------------------------------------------------------------------------

  async function proposals(view: Awaited<ReturnType<typeof open>>) {
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    await view.stable();
    const request = httpMock().expectOne(is('accounting/letterings/proposals/'));
    request.flush(
      page([
        {
          account: ACCOUNT,
          partner: PARTNER,
          currency: 'GNF',
          amount: '1200.000000',
          debit: {
            public_id: 'l-inv',
            entry: INVOICE.entry,
            entry_date: '2026-09-02',
            label: 'Facture',
          },
          credit: {
            public_id: 'l-pay2',
            entry: { public_id: 'e-pay2', entry_number: 'BQ1-000002' },
            entry_date: '2026-09-10',
            label: 'Règlement',
          },
        },
      ]),
    );
    await view.stable();
    return request;
  }

  it('proposals: shown as the server gives them, not a lettering', async () => {
    const view = await open(`${BASE}?vue=propositions`, READ);
    await proposals(view);
    const card = view.element().querySelector('.proposal')!;
    expect(text(card)).toContain('411100 · CLI-001');
    expect(text(card)).toContain('1 200 GNF');
    expect(text(card)).toContain('VTE-000001');
    expect(text(card)).toContain('BQ1-000002');
    expect(text(card)).toContain('Proposée, non lettrée');
    // accounting.read only: no confirmation offered.
    expect(view.button('Confirmer')).toBeUndefined();
  });

  it('a proposal is confirmed by the server’s command, then the proposals are read again', async () => {
    const view = await open(`${BASE}?vue=propositions`, LETTERER);
    await proposals(view);
    const confirm = view.element().querySelector<HTMLButtonElement>('.proposal button')!;
    expect(confirm.getAttribute('aria-label')).toBe(
      'Confirmer la proposition VTE-000001 / BQ1-000002',
    );
    confirm.click();
    confirm.click();
    await view.stable();
    const request = httpMock().expectOne(is('accounting/letterings/proposals/confirm/', 'POST'));
    expect(request.request.body).toEqual({
      debit: 'l-inv',
      credit: 'l-pay2',
      idempotency_key: expect.stringMatching(UUID),
    });
    request.flush(lettering({ kind: 'automatic', reference: 'LET-000002' }));
    await view.stable();
    expect(view.toasts()).toContain('Lettrage LET-000002 créé.');
    httpMock().expectOne(is('accounting/letterings/proposals/')).flush(page([]));
    await view.stable();
    expect(text(view.element())).toContain('Aucune proposition de lettrage.');
  });

  it('a stale proposal is refused by the server: said, and the proposals read again', async () => {
    const view = await open(`${BASE}?vue=propositions`, LETTERER);
    await proposals(view);
    view.element().querySelector<HTMLButtonElement>('.proposal button')!.click();
    await view.stable();
    httpMock()
      .expectOne(is('accounting/letterings/proposals/confirm/', 'POST'))
      .flush(envelope('accounting_lettering_not_a_proposal'), { status: 400, statusText: 'x' });
    await view.stable();
    expect(text(view.element())).toContain('Ces lignes ne forment plus une proposition.');
    httpMock().expectOne(is('accounting/letterings/proposals/')).flush(page([]));
    await view.stable();
  });

  // ---- Letterings, record, unlettering, history ------------------------------------------

  it('the letterings made, active and cancelled, each opening its record', async () => {
    const { element, stable } = await open(`${BASE}?vue=lettrages&etat=cancelled`, READ);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    await stable();
    const request = httpMock().expectOne(is('accounting/letterings/'));
    expect(request.request.params.get('status')).toBe('cancelled');
    request.flush(page([lettering({ status: 'cancelled' })]));
    await stable();
    const link = element().querySelector<HTMLAnchorElement>('alco-table a')!;
    expect(link.textContent?.trim()).toBe('LET-000001');
    expect(link.getAttribute('href')).toBe(`${BASE}/let-1`);
    expect(text(element())).toContain('Annulé');
  });

  it('unlettering: confirmed with a reason, by the command, then the lettering read again', async () => {
    const { element, stable, toasts, button } = await open(`${BASE}/let-1`);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock().expectOne(is('accounting/letterings/let-1/')).flush(lettering());
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/audit/objects/accounting.lettering/let-1/')
      .flush(page([]));
    await stable();
    expect(text(element())).toContain('Lettrage LET-000001');
    expect(element().querySelectorAll('#lignes tbody tr')).toHaveLength(2);
    const ask = vi
      .spyOn(TestBed.inject(UnletterDialogService), 'ask')
      .mockResolvedValue('Erreur de rapprochement');
    button('Délettrer')!.click();
    await stable();
    expect(ask).toHaveBeenCalledWith('LET-000001');
    const request = httpMock().expectOne(is('accounting/letterings/let-1/unletter/', 'POST'));
    expect(request.request.body).toEqual({ reason: 'Erreur de rapprochement' });
    const cancelled = lettering({
      status: 'cancelled',
      cancelled_by: 'u-1',
      cancelled_at: '2026-10-04T11:00:00Z',
      cancellation_reason: 'Erreur de rapprochement',
    });
    request.flush(cancelled);
    await stable();
    expect(toasts()).toContain('Lettrage annulé. Les lignes sont de nouveau ouvertes.');
    httpMock().expectOne(is('accounting/letterings/let-1/')).flush(cancelled);
    httpMock()
      .expectOne((req) => req.url === '/api/v1/audit/objects/accounting.lettering/let-1/')
      .flush(
        page([
          {
            public_id: 'ev-2',
            action: 'unletter',
            occurred_at: '2026-10-04T11:00:00Z',
            user: { email: 'test@example.org' },
          },
        ]),
      );
    await stable();
    expect(text(element())).toContain('Ce lettrage est annulé');
    expect(text(element())).toContain('Erreur de rapprochement');
    expect(text(element())).toContain('Délettrage');
    expect(button('Délettrer')).toBeUndefined();
  });

  it('without accounting.unletter, no Délettrer', async () => {
    const { button, stable } = await open(`${BASE}/let-1`, READ);
    httpMock()
      .expectOne(is('currencies/'))
      .flush(page([GNF]));
    httpMock().expectOne(is('accounting/letterings/let-1/')).flush(lettering());
    await stable();
    expect(button('Délettrer')).toBeUndefined();
  });

  it('after a company change, the lettering screen without its record nor filters', () => {
    TestBed.configureTestingModule({ providers: [...provideHttpTesting()] });
    openTestSession(TestBed.inject(SessionStore), { permissions: READ });
    const navigation = TestBed.inject(NavigationService);
    expect(navigation.landingUrl(`${BASE}/let-1`)).toBe(BASE);
    expect(navigation.landingUrl(BASE)).toBe(BASE);
  });

  // ---- Smart button of the account ----------------------------------------------------------

  const account = (letterable: boolean) => ({
    public_id: 'a-411',
    code: '411100',
    name: 'Clients',
    description: '',
    parent: null,
    account_type: 'asset',
    detailed_type: '',
    currency: null,
    allowed_journals: [],
    default_taxes: [],
    code_group: '41',
    account_class: '4',
    allow_entries: true,
    letterable,
    status: 'active',
    has_children: false,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  });

  it('account record: Lettrage with the server’s count of open lines, for a letterable account', async () => {
    const { element, stable } = await open('/app/comptabilite/plan-comptable/a-411', READ);
    httpMock().expectOne(is('accounting/accounts/a-411/')).flush(account(true));
    httpMock()
      .expectOne(is('accounting/entries/'))
      .flush(page([{}], 7));
    await stable();
    const count = httpMock().expectOne(is('accounting/letterable-lines/'));
    expect(count.request.params.get('account')).toBe('a-411');
    expect(count.request.params.get('status')).toBe('open');
    expect(count.request.params.get('page_size')).toBe('1');
    count.flush(page([{}], 4));
    await stable();
    const link = Array.from(element().querySelectorAll<HTMLAnchorElement>('a.smart')).find((item) =>
      item.getAttribute('aria-label')?.startsWith('Lettrage'),
    )!;
    expect(link.getAttribute('aria-label')).toBe('Lettrage : 4');
    expect(link.getAttribute('href')).toBe(`${BASE}?compte=411100`);
    expect(text(element())).toMatch(/Autoriser le lettrages*Oui/);
  });

  it('account record: no Lettrage for an account the server says is not letterable', async () => {
    const { element, stable } = await open('/app/comptabilite/plan-comptable/a-411', READ);
    httpMock().expectOne(is('accounting/accounts/a-411/')).flush(account(false));
    httpMock()
      .expectOne(is('accounting/entries/'))
      .flush(page([{}], 7));
    await stable();
    httpMock().expectNone(is('accounting/letterable-lines/'));
    const labels = Array.from(element().querySelectorAll('a.smart')).map((item) =>
      item.getAttribute('aria-label'),
    );
    expect(labels.some((label) => label?.startsWith('Lettrage'))).toBe(false);
    expect(text(element())).toMatch(/Autoriser le lettrages*Non/);
  });
});
