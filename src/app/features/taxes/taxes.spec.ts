import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { RepartitionLine, Tax } from './data-access/taxes-models';
import { TaxDetailPage } from './tax-detail';
import { TaxFormPage } from './tax-form';
import { TaxListPage } from './tax-list';

const lines = (account = '445200'): RepartitionLine[] => [
  { repartition_type: 'base', factor_percent: '100.0000', account_code: '', grids: ['goods_base'] },
  {
    repartition_type: 'tax',
    factor_percent: '100.0000',
    account_code: account,
    grids: ['goods_tax'],
  },
];
const tax = (name: string, extra: Partial<Tax> = {}): Tax => ({
  public_id: `t-${name.replace(/\W/g, '')}`,
  code: name.toUpperCase(),
  name,
  category: 'vat_deductible',
  country: 'GN',
  status: 'active',
  type_tax_use: 'purchase',
  tax_scope: '',
  amount_type: 'percent',
  amount: '18.0000',
  price_include_override: '',
  include_base_amount: false,
  description: '18% Produits',
  invoice_label: '',
  heading: 'T.V.A. 18%',
  fiscal_positions: ['National'],
  tax_category_code: '',
  legal_notes: '',
  invoice_lines: lines(),
  refund_lines: lines(),
  created_at: '2026-10-09T10:00:00Z',
  updated_at: '2026-10-09T10:00:00Z',
  ...extra,
});
const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const MANAGE = ['accounting.read', 'taxes.read', 'taxes.create', 'taxes.update'];

/** Side requests (names of accounts, groups and positions proposed): answered empty. */
function answerSideRequests(): void {
  for (const request of httpMock().match(
    (req) =>
      req.url.endsWith('/taxes/headings/') ||
      req.url.endsWith('/taxes/fiscal-positions/') ||
      req.url.endsWith('/accounting/accounts/') ||
      req.url.includes('/audit/'),
  )) {
    request.flush(page());
  }
}

describe('Taxes (taxes/) as Odoo’s screens', () => {
  async function open(url: string, permissions = MANAGE) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'taxes',
            data: { breadcrumb: 'Taxes' },
            children: [
              { path: '', component: TaxListPage },
              { path: 'nouveau', component: TaxFormPage },
              {
                path: ':id',
                data: { breadcrumb: 'Taxe' },
                children: [
                  { path: '', component: TaxDetailPage },
                  { path: 'modifier', component: TaxFormPage },
                ],
              },
            ],
          },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    const list = () => httpMock().expectOne((req) => req.url === '/api/v1/taxes/');
    return { element, stable, list, harness };
  }

  const fill = (element: HTMLElement, name: string, value: string) => {
    const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[formControlName="${name}"]`,
    )!;
    field.value = value;
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
  };

  afterEach(() => {
    answerSideRequests();
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('list: Odoo’s columns, « Ventes ou Achats » by default', async () => {
    const { element, stable, list } = await open('/taxes');
    const request = list();
    expect(request.request.params.getAll('type_tax_use')).toEqual(['sale', 'purchase']);
    request.flush(
      page([
        tax('18%', { type_tax_use: 'sale', description: '' }),
        tax('18% G', { invoice_label: 'TVA 18 %' }),
      ]),
    );
    await stable();
    const headers = Array.from(element.querySelectorAll('thead th')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Nom de la taxe',
      'Description',
      'Type de taxe',
      'Portée de la taxe',
      'Libellé sur les factures',
      'Actif',
    ]);
    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim()),
    );
    expect(rows[0].slice(0, 3)).toEqual(['18%', '', 'Ventes']);
    expect(rows[1].slice(0, 5)).toEqual(['18% G', '18% Produits', 'Achats', '', 'TVA 18 %']);
    expect(element.textContent).toContain('Ventes ou Achats');
  });

  it('list: the default filter removed shows every type', async () => {
    const { element, stable, list } = await open('/taxes');
    list().flush(page([tax('18%')]));
    await stable();
    element
      .querySelector<HTMLButtonElement>('[aria-label^="Retirer le critère Type de taxe"]')!
      .click();
    await stable();
    const all = list();
    expect(all.request.params.has('type_tax_use')).toBe(false);
    all.flush(page([tax('18%')]));
    await stable();
  });

  it('list: « Actif » switched from the row is a command, refused it goes back', async () => {
    const { element, stable, list } = await open('/taxes');
    list().flush(page([tax('18% G')]));
    await stable();
    const toggle = () => element.querySelector<HTMLInputElement>('input[role="switch"]')!;
    expect(toggle().getAttribute('aria-label')).toBe('Taxe 18% G active');

    toggle().click();
    await stable();
    httpMock()
      .expectOne('/api/v1/taxes/t-18G/deactivate/')
      .flush(tax('18% G', { status: 'inactive' }));
    await stable();
    expect(toggle().checked).toBe(false);

    toggle().click();
    await stable();
    httpMock()
      .expectOne('/api/v1/taxes/t-18G/activate/')
      .flush(envelope('tax_inactive'), { status: 400, statusText: 'x' });
    await stable();
    expect(toggle().checked).toBe(false);
  });

  it('record: Odoo’s header, the two repartitions, the advanced options in their tab', async () => {
    const { element, stable } = await open('/taxes/t-18G');
    httpMock().expectOne('/api/v1/taxes/t-18G/').flush(tax('18% G'));
    await stable();
    // The account named by the chart: one request by code.
    const account = httpMock().expectOne((req) => req.url === '/api/v1/accounting/accounts/');
    expect(account.request.params.get('code_prefix')).toBe('445200');
    account.flush(page([{ code: '445200', name: 'T.V.A. récupérable sur achats' }]));
    await stable();

    const facts = Array.from(element.querySelectorAll('.odoo-header .fact')).map((fact) =>
      Array.from(fact.children)
        .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
        .join(' ')
        .trim(),
    );
    expect(facts).toEqual([
      'Nom de la taxe 18% G',
      'Calcul de la taxe Pourcentage',
      'Actif Oui',
      'Type de taxe Achats',
      'Portée de la taxe',
      'Montant 18,0000 %',
      'Position fiscale National',
    ]);
    const titles = Array.from(element.querySelectorAll('alco-repartition-table h3')).map((title) =>
      title.textContent?.trim(),
    );
    expect(titles).toEqual([
      'Répartition pour les factures',
      'Répartition pour les notes de crédit',
    ]);
    const firstTable = element.querySelector('alco-repartition-table tbody')!;
    const cells = Array.from(firstTable.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim()),
    );
    expect(cells).toEqual([
      ['', 'Base', '', 'goods_base'],
      ['100,00', 'de la taxe', '445200 T.V.A. récupérable sur achats', 'goods_tax'],
    ]);

    const advanced = Array.from(element.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(
      (button) => button.textContent?.includes('Options avancées'),
    )!;
    advanced.click();
    await stable();
    const panel = element.querySelector('[role=tabpanel]')!.textContent ?? '';
    for (const words of [
      'Libellé sur les factures',
      'Groupe de taxes',
      'T.V.A. 18%',
      'Pays',
      'Code de catégorie fiscale',
      'Mentions légales',
      'Inclus dans le prix',
      'Par défaut',
      'Impacter la base des taxes ultérieures',
    ]) {
      expect(panel).toContain(words);
    }
  });

  it('form: Odoo’s fields and default lines; the server gets the whole form', async () => {
    const { element, stable } = await open('/taxes/nouveau');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    httpMock()
      .expectOne((req) => req.url === '/api/v1/taxes/headings/')
      .flush(page([{ public_id: 'h', name: 'T.V.A. 18%' }]));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/taxes/fiscal-positions/')
      .flush(page([{ public_id: 'p', name: 'National' }]));
    await stable();

    const names = Array.from(element.querySelectorAll('.odoo-header [formControlName]')).map(
      (field) => field.getAttribute('formControlName'),
    );
    expect(names).toEqual([
      'name',
      'amount_type',
      'active',
      'type_tax_use',
      'tax_scope',
      'amount',
      'fiscal_positions',
    ]);
    const types = element.querySelector<HTMLSelectElement>('[formControlName="type_tax_use"]')!;
    expect(Array.from(types.options).map((option) => option.textContent?.trim())).toEqual([
      'Ventes',
      'Achats',
      'Aucun',
    ]);
    // Odoo's lines of a new tax, on both sides: the base, then 100 % of the tax.
    const rows = element.querySelectorAll('table.lines tbody tr');
    expect(rows.length).toBe(4);
    expect(
      Array.from(rows[0].querySelectorAll<HTMLSelectElement>('select')).map((s) => s.value),
    ).toEqual(['base']);

    fill(element, 'name', '18% G');
    fill(element, 'type_tax_use', 'purchase');
    fill(element, 'amount', '18');
    const positions = element.querySelector<HTMLInputElement>(
      '[formControlName="fiscal_positions"] input',
    )!;
    positions.value = 'National';
    positions.dispatchEvent(new Event('input'));
    positions.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await stable();

    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const create = httpMock().expectOne((req) => req.method === 'POST');
    const base = { repartition_type: 'base', factor_percent: '100', account_code: '', grids: [] };
    const share = { repartition_type: 'tax', factor_percent: '100', account_code: '', grids: [] };
    expect(create.request.body).toEqual({
      name: '18% G',
      country: 'GN',
      type_tax_use: 'purchase',
      tax_scope: '',
      amount_type: 'percent',
      amount: '18',
      price_include_override: '',
      include_base_amount: false,
      description: '',
      invoice_label: '',
      heading: '',
      fiscal_positions: ['National'],
      tax_category_code: '',
      legal_notes: '',
      invoice_lines: [base, share],
      refund_lines: [base, share],
    });
    create.flush(tax('18% G'));
    await stable();
    expect(navigate).toHaveBeenCalledWith(['..', 't-18G'], expect.anything());
  });

  it('form: « Ajouter une ligne » and the server’s reason for a wrong repartition', async () => {
    const { element, stable } = await open('/taxes/nouveau');
    answerSideRequests();
    await stable();
    fill(element, 'name', 'Autoliquidation');
    const addButtons = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => button.textContent?.trim() === 'Ajouter une ligne',
    );
    expect(addButtons.length).toBe(2);
    addButtons[0].click();
    await stable();
    expect(element.querySelectorAll('table.lines')[0].querySelectorAll('tbody tr').length).toBe(3);

    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const create = httpMock().expectOne((req) => req.method === 'POST');
    expect((create.request.body as { invoice_lines: unknown[] }).invoice_lines.length).toBe(3);
    create.flush(
      {
        error: {
          code: 'tax_repartition_invalid',
          message: 'x',
          details: { side: 'invoice', reason: 'total' },
          correlation_id: 'c',
        },
      },
      { status: 400, statusText: 'x' },
    );
    await stable();
    expect(element.textContent).toContain(
      'La répartition pour les factures doit avoir des % positifs qui font 100',
    );
  });

  it('form: a modification sends the form, « Actif » goes through its command', async () => {
    const { element, stable } = await open('/taxes/t-18G/modifier');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    httpMock().expectOne('/api/v1/taxes/t-18G/').flush(tax('18% G'));
    await stable();
    answerSideRequests();
    expect(element.querySelector<HTMLInputElement>('[formControlName="amount"]')!.value).toBe(
      '18,0000',
    );
    fill(element, 'amount', '20');
    element.querySelector<HTMLInputElement>('[formControlName="active"]')!.click();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await stable();
    const patch = httpMock().expectOne('/api/v1/taxes/t-18G/');
    expect(patch.request.method).toBe('PATCH');
    const body = patch.request.body as { amount: string; invoice_lines: RepartitionLine[] };
    expect(body.amount).toBe('20');
    expect(body.invoice_lines[1]).toEqual({
      repartition_type: 'tax',
      factor_percent: '100.0000',
      account_code: '445200',
      grids: ['goods_tax'],
    });
    expect('status' in body).toBe(false);
    patch.flush(tax('18% G', { amount: '20.0000' }));
    await stable();
    httpMock()
      .expectOne('/api/v1/taxes/t-18G/deactivate/')
      .flush(tax('18% G', { status: 'inactive' }));
    await stable();
    expect(navigate).toHaveBeenCalled();
  });
});
