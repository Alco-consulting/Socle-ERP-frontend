import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { Declaration, DeclarationDetail } from './data-access/taxes-models';
import { DeclarationDetailPage } from './declaration-detail';
import { DeclarationDialogService } from './declaration-dialog';
import { DeclarationListPage } from './declaration-list';
import { monthBounds, periodLabel, previousMonth } from './declarations-presentation';

const BASE = '/api/v1/taxes/declarations/';
const CURRENCIES = '/api/v1/currencies/';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const ALL = ['taxes.read', 'taxes.manage_declarations', 'taxes.validate_declaration'];

function declaration(extra: Partial<DeclarationDetail> = {}): DeclarationDetail {
  return {
    public_id: 'd-1',
    declaration_type: 'TVA',
    country: 'GN',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    status: 'draft',
    calculated_amount: '72000.000000',
    declared_amount: '72000.000000',
    difference: '0.000000',
    checked_at: null,
    validated_at: null,
    declared_at: null,
    paid_at: null,
    created_at: '2026-04-02T10:00:00Z',
    updated_at: '2026-04-02T10:00:00Z',
    vat: {
      lines: [
        {
          tax: { public_id: 't-1', code: 'TVA18', name: 'TVA 18 %' },
          side: 'sale',
          base: '900000.000000',
          amount: '162000.000000',
        },
        {
          tax: { public_id: 't-1', code: 'TVA18', name: 'TVA 18 %' },
          side: 'purchase',
          base: '500000.000000',
          amount: '90000.000000',
        },
      ],
      collected: '162000.000000',
      deductible: '90000.000000',
      payable: '72000.000000',
    },
    next_steps: ['check'],
    ...extra,
  };
}

async function open(url: string, permissions = ALL) {
  TestBed.configureTestingModule({
    providers: [
      ...provideHttpTesting(),
      provideRouter([
        {
          path: 'declarations',
          children: [
            { path: '', component: DeclarationListPage },
            { path: ':id', component: DeclarationDetailPage },
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
  const button = (label: string) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === label,
    );
  // The reference currency's decimals: GNF, none.
  httpMock()
    .match((req) => req.url === CURRENCIES)
    .forEach((req) => req.flush(page([{ code: 'GNF', decimal_places: 0 }])));
  return { element, stable, button };
}

describe('Déclarations de TVA: periods', () => {
  it('names a whole month, and its bounds; the previous month by default', () => {
    expect(periodLabel('2026-03-01', '2026-03-31')).toBe('Mars 2026');
    expect(periodLabel('2026-03-01', '2026-03-15')).toBe('01/03/2026 → 15/03/2026');
    expect(monthBounds('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
    expect(previousMonth('2026-01-10')).toBe('2025-12');
  });
});

describe('Déclarations de TVA', () => {
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('the list: each month, what is due and its step', async () => {
    const { element, stable } = await open('/declarations');
    const row: Declaration = declaration();
    httpMock()
      .expectOne((req) => req.url === BASE)
      .flush(page([row]));
    await stable();

    expect(element.textContent).toContain('Mars 2026');
    expect(element.textContent).toMatch(/72\s000/);
    expect(element.textContent).toContain('Brouillon');
  });

  it('« Nouvelle déclaration » asks the month, creates it and opens it', async () => {
    const { stable, button } = await open('/declarations');
    httpMock()
      .expectOne((req) => req.url === BASE)
      .flush(page([]));
    await stable();
    vi.spyOn(TestBed.inject(DeclarationDialogService), 'ask').mockResolvedValue('2026-03');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    button('Nouvelle déclaration')!.click();
    await stable();
    const request = httpMock().expectOne({ method: 'POST', url: BASE });
    expect(request.request.body).toEqual({ period_start: '2026-03-01', period_end: '2026-03-31' });
    request.flush(declaration());
    await stable();

    expect(navigate).toHaveBeenCalledWith(['/app/comptabilite/taxes/declarations', 'd-1']);
  });

  it('the record: VAT collected, deductible, due, and the detail by tax', async () => {
    const { element, stable } = await open('/declarations/d-1');
    httpMock().expectOne(`${BASE}d-1/`).flush(declaration());
    await stable();

    const text = element.textContent ?? '';
    expect(text).toContain('TVA — Mars 2026');
    expect(text).toContain('TVA collectée');
    expect(text).toMatch(/162\s000/);
    expect(text).toContain('TVA à payer');
    expect(text).toContain('Ventes');
    expect(text).toContain('Achats');
  });

  it('only the steps the server opens, and that the user may run', async () => {
    const { stable, button } = await open('/declarations/d-1', [
      'taxes.read',
      'taxes.manage_declarations',
    ]);
    httpMock()
      .expectOne(`${BASE}d-1/`)
      .flush(declaration({ status: 'checked', next_steps: ['validate'] }));
    await stable();

    expect(button('Valider')).toBeUndefined();
    expect(button('Vérifier')).toBeUndefined();
  });

  it('« Valider » asks first, then shows the answer of the server', async () => {
    const { element, stable, button } = await open('/declarations/d-1');
    httpMock()
      .expectOne(`${BASE}d-1/`)
      .flush(declaration({ status: 'checked', next_steps: ['validate'] }));
    await stable();
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);

    button('Valider')!.click();
    await stable();
    httpMock()
      .expectOne({ method: 'POST', url: `${BASE}d-1/validate/` })
      .flush(declaration({ status: 'validated', next_steps: ['declare'] }));
    await stable();

    expect(confirm).toHaveBeenCalled();
    expect(button('Marquer déclarée')).toBeDefined();
    expect(element.querySelector('input[aria-label="Montant déclaré"]')).toBeNull();
  });

  it('the amount declared is saved alone, and a gap is shown', async () => {
    const { element, stable, button } = await open('/declarations/d-1');
    httpMock().expectOne(`${BASE}d-1/`).flush(declaration());
    await stable();
    const field = element.querySelector<HTMLInputElement>('input[aria-label="Montant déclaré"]')!;

    field.value = '70 000';
    field.dispatchEvent(new Event('input'));
    await stable();
    button('Enregistrer')!.click();
    await stable();
    const request = httpMock().expectOne({ method: 'PATCH', url: `${BASE}d-1/` });
    expect(request.request.body).toEqual({ declared_amount: '70000' });
    request.flush(declaration({ declared_amount: '70000.000000', difference: '-2000.000000' }));
    await stable();

    expect(element.querySelector('.gap')?.textContent).toMatch(/-2\s000/);
  });

  it('entries changed since the computation: said, recomputed at the next step', async () => {
    const { element, stable } = await open('/declarations/d-1');
    const changed = declaration();
    httpMock()
      .expectOne(`${BASE}d-1/`)
      .flush({ ...changed, vat: { ...changed.vat, payable: '80000' } });
    await stable();

    expect(element.textContent).toContain('la TVA sera recalculée à la prochaine');
  });
});
