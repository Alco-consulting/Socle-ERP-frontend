import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { ReconcileModelsPage } from './reconcile-models-page';

const page = (results: unknown[] = []) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const FEES = {
  public_id: 'm-fees',
  name: 'Frais bancaires',
  kind: 'account',
  account: { public_id: 'a-631', code: '631800', name: 'Autres frais bancaires' },
  destination: null,
  label: 'Frais bancaires',
  status: 'active',
};
const TRANSFER = {
  ...FEES,
  public_id: 'm-vir',
  name: 'Virements internes',
  kind: 'transfer',
  account: null,
  label: 'Virement interne',
};
const BANK = { public_id: 't-bq', code: 'BQ', name: 'Coris bank', status: 'active' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Modèles de rapprochement (treasury/reconcile-models/, note backend 0048)', () => {
  beforeEach(() => setCookie('XSRF-TOKEN', 'tok'));
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  async function open(permissions = ['treasury.read', 'treasury.manage_accounts']) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([{ path: 'modeles', component: ReconcileModelsPage }]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/modeles', ReconcileModelsPage);
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/reconcile-models/')
      .flush(page([FEES, TRANSFER]));
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/accounts/')
      .flush(page([BANK]));
    await stable();
    return { component, element, stable };
  }

  const button = (element: HTMLElement, label: string) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => text(item) === label || item.getAttribute('aria-label') === label,
    );

  it('as Odoo’s list: the models configured, an account or an internal transfer', async () => {
    const { element } = await open();
    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td'))
        .slice(0, 5)
        .map((cell) => text(cell)),
    );
    expect(rows).toEqual([
      ['Frais bancaires', 'Compte', '631800 Autres frais bancaires', 'Frais bancaires', 'Active'],
      [
        'Virements internes',
        'Virement interne',
        'Journal choisi sur la ligne',
        'Virement interne',
        'Active',
      ],
    ]);
    expect(button(element, 'Modifier Virements internes')).toBeDefined();
    expect(button(element, 'Archiver Frais bancaires')).toBeDefined();
  });

  it('« Nouveau » « Virement interne »: its journal, or the one chosen on the line', async () => {
    const { component, element, stable } = await open();
    button(element, 'Nouveau')!.click();
    await stable();
    component['form'].patchValue({ name: 'Versement en banque', kind: 'transfer' });
    await stable();
    const journal = element.querySelector<HTMLSelectElement>(
      'select[aria-label="Journal de destination"]',
    )!;
    expect(Array.from(journal.options).map((option) => text(option))).toEqual([
      'Journal choisi sur la ligne',
      'Coris bank',
    ]);
    expect(element.querySelector('alco-autocomplete[formControlName="account"]')).toBeNull();
    component['form'].patchValue({ destination: 't-bq' });
    button(element, 'Enregistrer')!.click();
    await stable();

    const create = httpMock().expectOne('/api/v1/treasury/reconcile-models/');
    expect(create.request.body).toEqual({
      name: 'Versement en banque',
      kind: 'transfer',
      account: null,
      destination: 't-bq',
      label: '',
    });
    create.flush({ ...TRANSFER, public_id: 'm-3' });
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/reconcile-models/')
      .flush(page([FEES, TRANSFER]));
  });

  it('« Nouveau »: its name, its account, its label', async () => {
    const { component, element, stable } = await open();
    button(element, 'Nouveau')!.click();
    await stable();
    component['form'].patchValue({
      name: 'Agios',
      account: { id: 'a-675', label: '675100' },
      label: 'Agios du mois',
    });
    button(element, 'Enregistrer')!.click();
    await stable();

    const create = httpMock().expectOne('/api/v1/treasury/reconcile-models/');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      name: 'Agios',
      kind: 'account',
      account: 'a-675',
      destination: null,
      label: 'Agios du mois',
    });
    create.flush({ ...FEES, public_id: 'm-2', name: 'Agios' });
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/treasury/reconcile-models/')
      .flush(page([FEES, TRANSFER]));
    await stable();
    expect(element.querySelector('tr.entry')).toBeNull();
  });

  it('nothing sent without a name and an account; read only: nothing to type', async () => {
    const { element, stable } = await open();
    button(element, 'Nouveau')!.click();
    await stable();
    button(element, 'Enregistrer')!.click();
    await stable();
    expect(text(element.querySelector('.entry-error'))).toBe(
      'Saisissez le nom du modèle et choisissez son compte.',
    );
    httpMock().expectNone((req) => req.method === 'POST');
  });

  it('read only: the list, no button', async () => {
    const { element } = await open(['treasury.read']);
    expect(element.querySelectorAll('button').length).toBe(0);
  });
});
