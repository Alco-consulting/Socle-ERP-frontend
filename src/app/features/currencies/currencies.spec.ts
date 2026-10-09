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
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { inverseRate, inverseRateText, rateText } from './currencies-presentation';
import { CurrencyFormPage } from './currency-form';
import { CurrencyListPage } from './currency-list';
import { Currency, CurrencyRate } from './data-access/currencies-models';

const currency = (code: string, extra: Partial<Currency> = {}): Currency => ({
  public_id: `cur-${code}`,
  code,
  name: code,
  symbol: code,
  decimal_places: 2,
  status: 'active',
  position: 'after',
  unit_label: '',
  subunit_label: '',
  ...extra,
});
const GNF = currency('GNF', { name: 'Franc guinéen', symbol: 'GNF', decimal_places: 0 });
const USD = currency('USD', {
  name: 'Dollar des États-Unis',
  symbol: '$',
  position: 'before',
  unit_label: 'Dollars',
  subunit_label: 'Cents',
});
const EUR = currency('EUR', { name: 'Euro', symbol: '€' });
const CHF = currency('CHF', { name: 'Franc suisse', symbol: 'CHF', status: 'inactive' });

const rate = (code: string, value: string, day: string, extra: Partial<CurrencyRate> = {}) => ({
  public_id: `rate-${code}-${day}`,
  currency: code,
  quote_currency: 'GNF',
  rate: value,
  rate_date: day,
  source: '',
  retrieved_at: null,
  status: 'active' as const,
  created_at: `${day}T08:00:00Z`,
  ...extra,
});
const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const READ = ['accounting.read', 'currencies.read'];
const MANAGE = [...READ, 'currencies.manage_rates'];
/** The catalogue is global: its permissions come from `auth/me/`. */
const CURATOR = ['currencies.create', 'currencies.update'];

function fill(element: HTMLElement, name: string, value: string): void {
  const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[formControlName="${name}"]`,
  )!;
  field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
}

const words = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('button, a')).map((item) => item.textContent?.trim());

describe('« Unité par GNF »: 1 ÷ the rate, exact, six significant digits', () => {
  it('computes the inverse without floating point, half up', () => {
    expect(inverseRate('8650')).toBe('0.000115607');
    expect(inverseRate('8650.125000000000')).toBe('0.000115605');
    expect(inverseRate('0.5')).toBe('2');
    expect(inverseRate('1')).toBe('1');
    expect(inverseRate('3')).toBe('0.333333');
    expect(inverseRate('0.15')).toBe('6.66667');
    expect(inverseRate('0.000001')).toBe('1000000');
  });

  it('a rounding that carries over adds a digit', () => {
    // 1 ÷ 0.1000000400 = 9.9999960…: six digits round up to 10.
    expect(inverseRate('0.1000000400')).toBe('10');
  });

  it('nothing for a value that is not a positive rate', () => {
    expect(inverseRate('0')).toBe('');
    expect(inverseRate('0.000')).toBe('');
    expect(inverseRate('-2')).toBe('');
    expect(inverseRate('abc')).toBe('');
  });

  it('French display: thousands spaced, decimal comma, trailing zeros dropped', () => {
    expect(inverseRateText('8650')).toBe('0,000115607');
    // Thousands separated by a narrow no-break space (U+202F).
    expect(rateText('8650.125000000000')).toBe('8\u202f650,125');
    expect(rateText('9400.000000000000')).toBe('9\u202f400');
  });
});

describe('Devises (currencies/): as Odoo shows them', () => {
  async function open(url: string, permissions = MANAGE, globalPermissions = CURATOR) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'devises',
            data: { breadcrumb: 'Devises' },
            children: [
              { path: '', component: CurrencyListPage },
              { path: 'nouvelle', component: CurrencyFormPage },
              { path: ':id', data: { breadcrumb: 'Devise' }, component: CurrencyFormPage },
            ],
          },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions, globalPermissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    return { element, stable, harness };
  }

  const catalogue = () => httpMock().expectOne((req) => req.url === '/api/v1/currencies/');
  const current = () =>
    httpMock().expectOne((req) => req.url === '/api/v1/currencies/rates/current/');
  const rates = () => httpMock().expectOne((req) => req.url === '/api/v1/currencies/rates/');

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('list: Devise, Symbole, Nom, Dernière mise à jour, Unité par GNF, GNF par unité, Actif', async () => {
    const { element, stable } = await open('/devises');
    const list = catalogue();
    // The catalogue is shared: no company header.
    expect(list.request.headers.has('X-Company-ID')).toBe(false);
    expect(list.request.params.get('page_size')).toBe('80');
    list.flush(page([GNF, EUR, USD, CHF], 170));
    current().flush([
      rate('EUR', '9400.000000000000', '2026-02-27'),
      rate('USD', '8650', '2026-03-02'),
    ]);
    await stable();

    const headers = Array.from(element.querySelectorAll('thead th')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Devise',
      'Symbole',
      'Nom',
      'Dernière mise à jour',
      'Unité par GNF',
      'GNF par unité',
      'Actif',
    ]);
    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td'))
        .slice(0, 6)
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()),
    );
    expect(rows).toEqual([
      // The company's currency: 1 by definition, no rate.
      ['GNF', 'GNF', 'Franc guinéen Devise de la société', '', '1', '1'],
      ['EUR', '€', 'Euro', '27/02/2026', '0,000106383', '9 400'],
      ['USD', '$', 'Dollar des États-Unis', '02/03/2026', '0,000115607', '8 650'],
      ['CHF', 'CHF', 'Franc suisse', '', '', ''],
    ]);
    const switches = Array.from(element.querySelectorAll<HTMLInputElement>('input[role="switch"]'));
    expect(switches.map((item) => item.checked)).toEqual([true, true, true, false]);
    // The company's currency stays active.
    expect(switches[0].disabled).toBe(true);
    expect(switches[3].disabled).toBe(false);
  });

  it('list: searched by code or name, filtered by state', async () => {
    await open('/devises?q=franc&etat=inactive');
    const list = catalogue();
    expect(list.request.params.get('search')).toBe('franc');
    expect(list.request.params.get('status')).toBe('inactive');
    list.flush(page([CHF]));
    current().flush([]);
  });

  it('list: « Actif » activates a currency of the catalogue; refused, it goes back', async () => {
    const { element, stable } = await open('/devises');
    catalogue().flush(page([GNF, CHF]));
    current().flush([]);
    await stable();
    const toggle = () => element.querySelectorAll<HTMLInputElement>('input[role="switch"]')[1];
    expect(toggle().getAttribute('aria-label')).toBe('Devise CHF active');

    toggle().click();
    await stable();
    const activate = httpMock().expectOne('/api/v1/currencies/cur-CHF/');
    expect(activate.request.method).toBe('PATCH');
    expect(activate.request.body).toEqual({ status: 'active' });
    expect(activate.request.headers.has('X-Company-ID')).toBe(false);
    activate.flush({ ...CHF, status: 'active' });
    await stable();
    expect(toggle().checked).toBe(true);

    toggle().click();
    await stable();
    httpMock()
      .expectOne('/api/v1/currencies/cur-CHF/')
      .flush(envelope('reference_currency_in_use'), { status: 400, statusText: 'x' });
    await stable();
    expect(toggle().checked).toBe(true);
  });

  it('list: without the global currencies.update, « Actif » is read only', async () => {
    const { element, stable } = await open('/devises', READ, []);
    catalogue().flush(page([GNF, CHF]));
    current().flush([]);
    await stable();
    const switches = Array.from(element.querySelectorAll<HTMLInputElement>('input[role="switch"]'));
    expect(switches.every((item) => item.disabled)).toBe(true);
    expect(words(element)).not.toContain('Nouvelle devise');
  });

  it('form: the fields of Odoo, then « Taux » with Date, Unité par GNF, GNF par unité', async () => {
    const { element, stable } = await open('/devises/cur-USD');
    httpMock().expectOne('/api/v1/currencies/cur-USD/').flush(USD);
    await stable();
    const history = rates();
    expect(history.request.params.get('currency')).toBe('USD');
    expect(history.request.params.get('status')).toBe('active');
    history.flush(page([rate('USD', '8650.000000000000', '2026-03-02', { source: 'BCRG' })]));
    await stable();

    expect(element.querySelector('h1')?.textContent).toContain('USD');
    const names = Array.from(element.querySelectorAll('#currency-form [formControlName]')).map(
      (field) => field.getAttribute('formControlName'),
    );
    expect(names).toEqual([
      'code',
      'name',
      'decimal_places',
      'active',
      'symbol',
      'unit_label',
      'subunit_label',
      'position',
    ]);
    // The code and the decimal places never change.
    const field = (name: string) =>
      element.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
    expect(field('code').disabled).toBe(true);
    expect(field('decimal_places').disabled).toBe(true);
    expect(field('name').disabled).toBe(false);
    expect(field('position').value).toBe('before');

    expect(element.querySelector('[role="tab"]')?.textContent).toContain('Taux');
    const headers = Array.from(element.querySelectorAll('.rates thead th')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(headers).toEqual(['Date', 'Unité par GNF', 'GNF par unité', 'Source', 'Actions']);
    const cells = Array.from(element.querySelectorAll('.rates tbody td'))
      .slice(0, 4)
      .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim());
    expect(cells).toEqual(['02/03/2026', '0,000115607', '8 650', 'BCRG']);
  });

  it('form: the name, symbol, units and position are saved; « Actif » with them', async () => {
    const { element, stable } = await open('/devises/cur-USD');
    httpMock().expectOne('/api/v1/currencies/cur-USD/').flush(USD);
    await stable();
    rates().flush(page());
    await stable();

    fill(element, 'name', 'Dollar américain');
    fill(element, 'subunit_label', 'Centimes');
    element.querySelector<HTMLInputElement>('[formControlName="active"]')!.click();
    element.querySelector('#currency-form')!.dispatchEvent(new Event('submit'));
    await stable();
    const patch = httpMock().expectOne('/api/v1/currencies/cur-USD/');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      name: 'Dollar américain',
      symbol: '$',
      position: 'before',
      unit_label: 'Dollars',
      subunit_label: 'Centimes',
      status: 'inactive',
    });
    patch.flush({
      ...USD,
      name: 'Dollar américain',
      subunit_label: 'Centimes',
      status: 'inactive',
    });
    await stable();
    // Inactive: no new rate.
    expect(element.textContent).toContain('Activez la devise pour saisir ses taux.');
  });

  it('form: « Ajouter une ligne » records a rate at once, « Unité par GNF » shown as typed', async () => {
    const { element, stable } = await open('/devises/cur-USD');
    httpMock().expectOne('/api/v1/currencies/cur-USD/').flush(USD);
    await stable();
    rates().flush(page());
    await stable();
    expect(element.textContent).toContain('Aucun taux pour cette devise.');

    Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Ajouter une ligne')!
      .click();
    await stable();
    fill(element, 'rate_date', '2026-03-02');
    fill(element, 'rate', '8 650,5');
    await stable();
    expect(element.querySelector('.new-rate')?.textContent).toContain('Unité par GNF : 0,0001156');
    element.querySelector('.new-rate')!.dispatchEvent(new Event('submit'));
    await stable();
    const create = httpMock().expectOne(
      (req) => req.url === '/api/v1/currencies/rates/' && req.method === 'POST',
    );
    expect(create.request.body).toEqual({
      currency: 'USD',
      rate: '8650.5',
      rate_date: '2026-03-02',
      source: '',
    });
    create.flush(rate('USD', '8650.500000000000', '2026-03-02'));
    await stable();
    rates().flush(page([rate('USD', '8650.500000000000', '2026-03-02')]));
    await stable();
    expect(element.querySelector('.new-rate')).toBeNull();
    expect(element.querySelector('.rates tbody')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '8 650,5',
    );
  });

  it('form: a rate of the same day is refused with its reason', async () => {
    const { element, stable } = await open('/devises/cur-USD');
    httpMock().expectOne('/api/v1/currencies/cur-USD/').flush(USD);
    await stable();
    rates().flush(page());
    await stable();
    Array.from(element.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Ajouter une ligne')!
      .click();
    await stable();
    fill(element, 'rate', '8650');
    element.querySelector('.new-rate')!.dispatchEvent(new Event('submit'));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/currencies/rates/' && req.method === 'POST')
      .flush(envelope('exchange_rate_exists'), { status: 400, statusText: 'x' });
    await stable();
    expect(element.querySelector('.new-rate')?.textContent).toContain(
      'Un taux existe déjà pour cette devise à cette date.',
    );
  });

  it('form: a wrong rate is withdrawn after a confirmation', async () => {
    const { element, stable } = await open('/devises/cur-USD');
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    httpMock().expectOne('/api/v1/currencies/cur-USD/').flush(USD);
    await stable();
    rates().flush(page([rate('USD', '86500', '2026-03-02')]));
    await stable();

    element
      .querySelector<HTMLButtonElement>('[aria-label="Retirer le taux du 02/03/2026"]')!
      .click();
    await stable();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Retirer ce taux ?', tone: 'danger' }),
    );
    httpMock()
      .expectOne('/api/v1/currencies/rates/rate-USD-2026-03-02/withdraw/')
      .flush(rate('USD', '86500', '2026-03-02', { status: 'withdrawn' }));
    await stable();
    rates().flush(page());
    await stable();
    expect(element.textContent).toContain('Aucun taux pour cette devise.');
  });

  it('form: the company’s currency has no rate', async () => {
    const { element, stable } = await open('/devises/cur-GNF');
    httpMock().expectOne('/api/v1/currencies/cur-GNF/').flush(GNF);
    await stable();
    expect(element.textContent).toContain('GNF est la devise de la société');
    expect(words(element)).not.toContain('Ajouter une ligne');
  });

  it('form: a new currency — code and decimals at creation, then its page', async () => {
    const { element, stable } = await open('/devises/nouvelle');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await stable();
    fill(element, 'code', 'xts');
    fill(element, 'name', 'Devise de test');
    fill(element, 'decimal_places', '3: 3');
    element.querySelector('#currency-form')!.dispatchEvent(new Event('submit'));
    await stable();
    const create = httpMock().expectOne('/api/v1/currencies/');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      code: 'XTS',
      name: 'Devise de test',
      decimal_places: 3,
      symbol: '',
      position: 'after',
      unit_label: '',
      subunit_label: '',
    });
    create.flush(currency('XTS', { name: 'Devise de test', decimal_places: 3 }));
    await stable();
    expect(navigate).toHaveBeenCalledWith(['/app/comptabilite/configuration/devises', 'cur-XTS'], {
      replaceUrl: true,
    });
    expect(element.textContent).toContain('Enregistrez d’abord la devise');
  });

  it('form: without the global currencies.update the currency is read only', async () => {
    const { element, stable } = await open('/devises/cur-USD', READ, []);
    httpMock().expectOne('/api/v1/currencies/cur-USD/').flush(USD);
    await stable();
    rates().flush(page());
    await stable();
    expect(element.querySelector<HTMLInputElement>('[formControlName="name"]')!.disabled).toBe(
      true,
    );
    expect(words(element)).not.toContain('Enregistrer');
    // Without currencies.manage_rates, no rate is entered either.
    expect(words(element)).not.toContain('Ajouter une ligne');
  });
});
