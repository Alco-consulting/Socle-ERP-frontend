import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AssetDetailPage } from './asset-detail';
import { AssetFormPage } from './asset-form';
import { AssetListPage } from './asset-list';
import { durationText, lastMonthEnd, monthEnd } from './assets-presentation';
import { AssetCategoryListPage } from './category-list';
import { Asset, AssetCategory, DepreciationPlan } from './data-access/assets-models';
import { DepreciationPage } from './depreciation-page';
import { DisposeDialogService } from './dispose-dialog';

const BASE = '/api/v1/assets/';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const ALL = [
  'assets.read',
  'assets.create',
  'assets.update',
  'assets.activate',
  'assets.depreciate',
  'assets.dispose',
  'assets.account',
  'assets.manage_categories',
];

const CATEGORY: AssetCategory = {
  public_id: 'c-1',
  code: 'TRA',
  name: 'Matériel de transport',
  status: 'active',
  journal: { public_id: 'j-1', code: 'OD' },
  asset_account: { public_id: 'a-1', code: '245100' },
  accumulated_depreciation_account: { public_id: 'a-2', code: '284500' },
  depreciation_expense_account: { public_id: 'a-3', code: '681300' },
  disposal_value_account: null,
  disposal_proceeds_account: null,
  default_method: 'linear',
  default_duration_months: 48,
};

function asset(extra: Partial<Asset> = {}): Asset {
  return {
    public_id: 'as-1',
    code: '',
    name: 'Camion',
    reference: '',
    category: { public_id: 'c-1', code: 'TRA' },
    status: 'draft',
    acquisition_date: '2026-01-15',
    commissioning_date: null,
    disposal_date: null,
    currency: 'GNF',
    gross_value: '48000000.000000',
    residual_value: '0.000000',
    values: null,
    method: 'linear',
    duration_months: 48,
    partner: null,
    reason: '',
    ...extra,
  };
}

function plan(statuses: readonly ('planned' | 'accounted')[]): DepreciationPlan {
  return {
    public_id: 'p-1',
    kind: 'accounting',
    version: 1,
    status: 'active',
    lines: statuses.map((status, index) => ({
      public_id: `l-${index + 1}`,
      sequence: index + 1,
      period_start: `2026-0${index + 1}-01`,
      period_end: `2026-0${index + 1}-28`,
      amount: '1000000.000000',
      cumulative: `${(index + 1) * 1000000}.000000`,
      net_value: `${48000000 - (index + 1) * 1000000}.000000`,
      status,
      accounting_entry: null,
    })),
  };
}

async function open(url: string, permissions = ALL) {
  TestBed.configureTestingModule({
    providers: [
      ...provideHttpTesting(),
      provideRouter([
        {
          path: 'actifs',
          children: [
            { path: '', component: AssetListPage },
            { path: 'nouvelle', component: AssetFormPage },
            { path: ':id', component: AssetDetailPage },
          ],
        },
        { path: 'categories', component: AssetCategoryListPage },
        { path: 'amortissements', component: DepreciationPage },
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
  const button = (label: string) =>
    Array.from(element.querySelectorAll<HTMLElement>('button, a')).find(
      (item) => item.textContent?.trim() === label,
    );
  httpMock()
    .match((req) => req.url === '/api/v1/currencies/')
    .forEach((req) => req.flush(page([{ code: 'GNF', decimal_places: 0 }])));
  return { element, stable, button };
}

describe('Immobilisations: words', () => {
  it('durations in years and months, the usual month ends', () => {
    expect(durationText(48)).toBe('4 ans');
    expect(durationText(18)).toBe('1 an et 6 mois');
    expect(durationText(6)).toBe('6 mois');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(lastMonthEnd('2026-03-10')).toBe('2026-02-28');
  });
});

describe('Immobilisations', () => {
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('the categories, and the usual ones on demand', async () => {
    const { element, stable, button } = await open('/categories');
    httpMock()
      .expectOne((req) => req.url === `${BASE}categories/`)
      .flush(page([]));
    await stable();
    expect(element.textContent).toContain('Aucune catégorie pour l’instant.');

    button('Créer les catégories usuelles')!.click();
    await stable();
    httpMock()
      .expectOne({ method: 'POST', url: `${BASE}categories/defaults/` })
      .flush({ created: [CATEGORY], existing: [] });
    await stable();
    httpMock()
      .expectOne((req) => req.url === `${BASE}categories/`)
      .flush(page([CATEGORY]));
    await stable();

    expect(element.textContent).toContain('Matériel de transport');
    expect(element.textContent).toContain('4 ans');
  });

  it('the register: gross and net values, the state', async () => {
    const { element, stable } = await open('/actifs');
    httpMock()
      .expectOne((req) => req.url === BASE)
      .flush(
        page([
          asset({
            status: 'in_service',
            code: 'TRA-000001',
            values: {
              gross_value: '48000000',
              residual_value: '0',
              accumulated_depreciation: '3000000',
              accumulated_impairment: '0',
              net_book_value: '45000000',
              fully_depreciated: false,
            },
          }),
        ]),
      );
    await stable();

    const text = element.textContent ?? '';
    expect(text).toContain('TRA-000001');
    expect(text).toMatch(/45\s000\s000/);
    expect(text).toContain('En service');
  });

  it('a new asset: the category proposes its duration, the draft is created', async () => {
    const { element, stable } = await open('/actifs/nouvelle');
    httpMock()
      .expectOne((req) => req.url === `${BASE}categories/`)
      .flush(page([CATEGORY]));
    await stable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const field = (name: string) =>
      element.querySelector<HTMLInputElement | HTMLSelectElement>(`[formcontrolname=${name}]`)!;

    field('name').value = 'Camion';
    field('name').dispatchEvent(new Event('input'));
    field('category').value = 'c-1';
    field('category').dispatchEvent(new Event('change'));
    field('gross_value').value = '48 000 000';
    field('gross_value').dispatchEvent(new Event('input'));
    await stable();
    expect((field('duration_months') as HTMLInputElement).value).toBe('48');
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await stable();

    const request = httpMock().expectOne({ method: 'POST', url: BASE });
    expect(request.request.body).toMatchObject({
      category: 'c-1',
      name: 'Camion',
      currency: 'GNF',
      gross_value: '48000000',
      duration_months: 48,
      partner: null,
    });
    request.flush(asset());
    await stable();
    expect(navigate).toHaveBeenCalled();
  });

  it('« Confirmer » a draft, after asking', async () => {
    const { stable, button } = await open('/actifs/as-1');
    httpMock().expectOne(`${BASE}as-1/`).flush(asset());
    httpMock().expectOne(`${BASE}as-1/schedule/`).flush([]);
    await stable();
    vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);

    button('Confirmer')!.click();
    await stable();
    httpMock()
      .expectOne({ method: 'POST', url: `${BASE}as-1/confirm/` })
      .flush(asset({ status: 'in_service', code: 'TRA-000001' }));
    await stable();
    httpMock()
      .expectOne(`${BASE}as-1/`)
      .flush(asset({ status: 'in_service', code: 'TRA-000001' }));
    httpMock()
      .expectOne(`${BASE}as-1/schedule/`)
      .flush([plan(['planned', 'planned'])]);
    await stable();

    expect(button('Confirmer')).toBeUndefined();
    expect(button('Céder / mettre au rebut')).toBeDefined();
  });

  it('a sale: one call, the server depreciates up to the date and posts', async () => {
    const { stable, button } = await open('/actifs/as-1');
    httpMock()
      .expectOne(`${BASE}as-1/`)
      .flush(asset({ status: 'in_service', code: 'TRA-000001' }));
    httpMock()
      .expectOne(`${BASE}as-1/schedule/`)
      .flush([plan(['accounted', 'planned', 'planned'])]);
    await stable();
    const disposal = {
      kind: 'sale' as const,
      disposal_date: '2026-02-15',
      reason: 'Vendu',
      proceeds: '40000000',
      proceeds_account: 'acc-411',
    };
    vi.spyOn(TestBed.inject(DisposeDialogService), 'ask').mockResolvedValue(disposal);

    button('Céder / mettre au rebut')!.click();
    await stable();
    const request = httpMock().expectOne({ method: 'POST', url: `${BASE}as-1/dispose/` });
    expect(request.request.body).toEqual(disposal);
    request.flush({ public_id: 'd-1' });
    await stable();
    httpMock()
      .expectOne(`${BASE}as-1/`)
      .flush(asset({ status: 'disposed' }));
    httpMock().expectOne(`${BASE}as-1/schedule/`).flush([]);
    await stable();
  });

  it('the depreciation due posted at once, the assets refused named', async () => {
    const { element, stable, button } = await open('/amortissements');
    httpMock()
      .expectOne((req) => req.url === `${BASE}depreciation-lines/`)
      .flush({ count: 5, next: null, previous: null, results: [{}] });
    await stable();
    expect(element.textContent).toContain('5 dotations à comptabiliser');

    button('Comptabiliser')!.click();
    await stable();
    httpMock()
      .expectOne({ method: 'POST', url: `${BASE}depreciation-lines/post-due/` })
      .flush({
        posted: 4,
        failures: [
          {
            asset: { public_id: 'as-2', code: 'MOB-000001', name: 'Bureau' },
            code: 'assets_account_missing',
          },
        ],
      });
    await stable();
    httpMock()
      .expectOne((req) => req.url === `${BASE}depreciation-lines/`)
      .flush({ count: 1, next: null, previous: null, results: [{}] });
    await stable();

    expect(element.textContent).toContain('Bureau · MOB-000001');
    expect(element.textContent).toContain('Un compte manque dans la catégorie.');
  });
});
