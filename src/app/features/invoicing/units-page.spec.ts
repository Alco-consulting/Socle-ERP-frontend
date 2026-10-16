import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { UnitsPage } from './units-page';

const page = (results: unknown[] = []) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const unit = (id: string, name: string, unitType: string, factor: string) => ({
  public_id: id,
  name,
  unit_type: unitType,
  ratio: '1.000000',
  factor,
  status: 'active',
});
const CATEGORIES = [
  {
    public_id: 'c-w',
    name: 'Poids',
    units: [
      unit('u-kg', 'kg', 'reference', '1.000000000000'),
      unit('u-g', 'g', 'smaller', '0.001000000000'),
      unit('u-t', 't', 'bigger', '1000.000000000000'),
    ],
  },
  // A unit apart: alone in its family, no conversion.
  {
    public_id: 'c-b',
    name: 'Bonbonne',
    units: [unit('u-b', 'Bonbonne', 'reference', '1.000000000000')],
  },
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Unités de mesure (« 1 Sac = 50 kg », note backend 0047)', () => {
  beforeEach(() => setCookie('XSRF-TOKEN', 'tok'));
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  async function open(permissions = ['invoicing.read', 'invoicing.manage_products']) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([{ path: 'unites', component: UnitsPage }]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/unites', UnitsPage);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    httpMock()
      .expectOne((req) => req.url === '/api/v1/invoicing/unit-categories/')
      .flush(page(CATEGORIES));
    await stable();
    return { element, stable };
  }

  const button = (element: HTMLElement, label: string) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => text(item) === label || item.getAttribute('aria-label') === label,
    );
  const field = (element: HTMLElement, label: string) =>
    element.querySelector<HTMLInputElement & HTMLSelectElement>(`[aria-label="${label}"]`);
  const type = (element: HTMLElement, label: string, value: string) => {
    const found = field(element, label)!;
    found.value = value;
    found.dispatchEvent(new Event(found instanceof HTMLSelectElement ? 'change' : 'input'));
  };
  const options = (element: HTMLElement) =>
    Array.from(field(element, 'Unité de l’équivalence')!.options).map((option) => text(option));

  async function saved(stable: () => Promise<void>, url: string, body: object) {
    button(document.body, 'Enregistrer')!.click();
    await stable();
    const request = httpMock().expectOne(url);
    expect(request.request.body).toEqual(body);
    request.flush(unit('u-new', 'x', 'bigger', '1'));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/invoicing/unit-categories/')
      .flush(page(CATEGORIES));
    await stable();
  }

  it('each unit and what one of it is worth, in plain words', async () => {
    const { element } = await open();

    expect(Array.from(element.querySelectorAll('thead th')).map((cell) => text(cell))).toEqual([
      'Unité',
      'Équivalence',
      'Statut',
      'Actions',
    ]);
    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td'))
        .slice(0, 3)
        .map((cell) => text(cell)),
    );
    expect(rows).toEqual([
      ['kg', 'Unité de base', 'Active'],
      ['g', '1 g = 0,001 kg', 'Active'],
      ['t', '1 t = 1 000 kg', 'Active'],
      ['Bonbonne', '—', 'Active'],
    ]);
    // The base of other units stays: renamed only, never archived.
    expect(button(element, 'Archiver kg')).toBeUndefined();
    expect(button(element, 'Archiver g')).toBeDefined();
    expect(button(element, 'Archiver Bonbonne')).toBeDefined();
  });

  it('« Nouvelle unité »: 1 Sac = 50 kg, or a unit without conversion', async () => {
    const { element, stable } = await open();
    button(element, 'Nouvelle unité')!.click();
    await stable();
    type(element, 'Nom de l’unité', 'Sac');
    await stable();
    expect(text(element.querySelector('tr.entry .lead'))).toBe('1 Sac =');
    expect(options(element)).toEqual(['Sans conversion', 'kg', 'g', 't', 'Bonbonne']);
    type(element, 'Quantité', '50');
    type(element, 'Unité de l’équivalence', 'u-kg');
    await saved(stable, '/api/v1/invoicing/units/', { name: 'Sac', quantity: '50', of: 'u-kg' });
    expect(element.querySelector('tr.entry')).toBeNull();

    button(element, 'Nouvelle unité')!.click();
    await stable();
    type(element, 'Nom de l’unité', 'Carton');
    await saved(stable, '/api/v1/invoicing/units/', { name: 'Carton' });
  });

  it('« Modifier »: the equivalence typed again; the base renamed only; a unit apart joins kg', async () => {
    const { element, stable } = await open();
    button(element, 'Modifier t')!.click();
    await stable();
    expect(field(element, 'Quantité')!.value).toBe('1000');
    expect(field(element, 'Unité de l’équivalence')!.value).toBe('u-kg');
    expect(options(element)).toEqual(['kg', 'g', 'Bonbonne']);
    type(element, 'Quantité', '1 000');
    await saved(stable, '/api/v1/invoicing/units/u-t/', {
      name: 't',
      quantity: '1000',
      of: 'u-kg',
    });

    button(element, 'Modifier kg')!.click();
    await stable();
    expect(field(element, 'Quantité')).toBeNull();
    type(element, 'Nom de l’unité', 'Kilogramme');
    await saved(stable, '/api/v1/invoicing/units/u-kg/', { name: 'Kilogramme' });

    button(element, 'Modifier Bonbonne')!.click();
    await stable();
    expect(options(element)[0]).toBe('Sans conversion');
    type(element, 'Quantité', '20');
    type(element, 'Unité de l’équivalence', 'u-kg');
    await saved(stable, '/api/v1/invoicing/units/u-b/', {
      name: 'Bonbonne',
      quantity: '20',
      of: 'u-kg',
    });
  });

  it('nothing sent without the quantity of an equivalence', async () => {
    const { element, stable } = await open();
    button(element, 'Nouvelle unité')!.click();
    await stable();
    type(element, 'Nom de l’unité', 'Sac');
    type(element, 'Unité de l’équivalence', 'u-kg');
    button(element, 'Enregistrer')!.click();
    await stable();
    expect(text(element.querySelector('.entry-error'))).toBe('Saisissez combien vaut 1 Sac.');
    httpMock().expectNone('/api/v1/invoicing/units/');
  });

  it('read only: the list, nothing to type', async () => {
    const { element } = await open(['invoicing.read']);
    expect(element.querySelectorAll('button').length).toBe(0);
  });
});
