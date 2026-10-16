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
const unit = (id: string, name: string, unitType: string, ratio: string) => ({
  public_id: id,
  name,
  unit_type: unitType,
  ratio,
  factor: '1',
  status: 'active',
});
const WEIGHT = {
  public_id: 'c-w',
  name: 'Poids',
  units: [unit('u-kg', 'kg', 'reference', '1.000000'), unit('u-g', 'g', 'smaller', '1000.000000')],
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Unités de mesure (invoicing/unit-categories/, note backend 0047)', () => {
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
      .flush(page([WEIGHT]));
    await stable();
    return { element, stable };
  }

  const button = (element: HTMLElement, label: string) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => text(item) === label || item.getAttribute('aria-label') === label,
    )!;
  const type = (element: HTMLElement, label: string, value: string) => {
    const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[aria-label="${label}"]`,
    )!;
    field.value = value;
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
  };

  it('as Odoo’s list: each category, its reference first, the type and ratio of each unit', async () => {
    const { element } = await open();

    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td'))
        .slice(0, 4)
        .map((cell) => text(cell)),
    );
    expect(rows).toEqual([
      ['Poids', 'Ajouter une unité à Poids'],
      ['kg', 'Unité de référence de la catégorie', '1', 'Active'],
      ['g', 'Plus petite que la référence', '1000', 'Active'],
    ]);
    // The reference stays: it is renamed only, never archived.
    expect(button(element, 'Archiver kg')).toBeUndefined();
    expect(button(element, 'Archiver g')).toBeDefined();
  });

  it('a bag of 50 kg: bigger than the kg, ratio 50, typed in the list', async () => {
    const { element, stable } = await open();
    button(element, 'Ajouter une unité à Poids').click();
    await stable();
    type(element, 'Nom de l’unité', 'Sac de 50 kg');
    type(element, 'Ratio', '50');
    button(element, 'Enregistrer').click();
    await stable();

    const create = httpMock().expectOne('/api/v1/invoicing/units/');
    expect(create.request.body).toEqual({
      category: 'c-w',
      name: 'Sac de 50 kg',
      unit_type: 'bigger',
      ratio: '50',
    });
    create.flush(unit('u-sac', 'Sac de 50 kg', 'bigger', '50.000000'));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/invoicing/unit-categories/')
      .flush(page([WEIGHT]));
    await stable();
    expect(element.querySelector('tr.entry')).toBeNull();
  });

  it('the reference renamed only; a new category with its reference unit', async () => {
    const { element, stable } = await open();
    button(element, 'Modifier kg').click();
    await stable();
    expect(element.querySelector('[aria-label="Ratio"]')).toBeNull();
    type(element, 'Nom de l’unité', 'Kilogramme');
    button(element, 'Enregistrer').click();
    await stable();
    const rename = httpMock().expectOne('/api/v1/invoicing/units/u-kg/');
    expect(rename.request.body).toEqual({ name: 'Kilogramme' });
    rename.flush(unit('u-kg', 'Kilogramme', 'reference', '1.000000'));
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/invoicing/unit-categories/')
      .flush(page([WEIGHT]));
    await stable();

    button(element, 'Nouvelle catégorie').click();
    await stable();
    type(element, 'Nom de la catégorie', 'Surface');
    type(element, 'Unité de référence', 'm²');
    button(element, 'Enregistrer').click();
    await stable();
    const create = httpMock().expectOne('/api/v1/invoicing/unit-categories/');
    expect(create.request.body).toEqual({ name: 'Surface', reference_unit: 'm²' });
    create.flush({ public_id: 'c-s', name: 'Surface', units: [] });
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/invoicing/unit-categories/')
      .flush(page([WEIGHT]));
  });

  it('read only: the list, nothing to type', async () => {
    const { element } = await open(['invoicing.read']);
    expect(element.querySelectorAll('button').length).toBe(0);
  });
});
