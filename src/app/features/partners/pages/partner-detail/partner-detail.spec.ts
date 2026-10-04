import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../../core/http/testing';
import { BreadcrumbService } from '../../../../core/navigation/route-trail';
import { SessionStore } from '../../../../core/session/session.store';
import { openTestSession } from '../../../../core/session/testing';
import { AlcoConfirmService } from '../../../../shared/ui/confirm-dialog/confirm-dialog';
import { Partner } from '../../data-access/partner-models';
import { PartnerDetailPage } from './partner-detail';

const PARTNER: Partner = {
  public_id: 'p-1',
  code: 'FOU-007',
  name: 'Diallo et Cie',
  legal_name: 'Diallo et Compagnie SA',
  is_customer: false,
  is_supplier: true,
  country: 'GN',
  tax_identifier: 'NIF-77',
  status: 'active',
  registration_number: 'RCCM-1',
  address: 'Kaloum\nConakry',
  city: 'Conakry',
  phone: '+224 622 00 00 00',
  email: 'contact@diallo.example',
  default_currency: 'GNF',
  customer_payment_term: null,
  supplier_payment_term: {
    public_id: 't-1',
    code: '30J',
    name: '30 jours',
    status: 'active',
    lines: [],
  },
  default_tax_code: '',
  customer_account_code: '',
  supplier_account_code: '401',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PartnerDetailPage (the record)', () => {
  async function open(permissions: string[]) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'liste',
            data: { breadcrumb: 'Tous les tiers' },
            children: [
              {
                path: ':id',
                data: { breadcrumb: 'Fiche du tiers' },
                component: PartnerDetailPage,
              },
            ],
          },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    setCookie('XSRF-TOKEN', 'tok');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/liste/p-1');
    const element = harness.routeNativeElement as HTMLElement;
    const stable = async () => {
      await settle();
      await harness.fixture.whenStable();
    };
    return { harness, element, stable };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('shows the record the API gives, named in the breadcrumb', async () => {
    const { element, stable } = await open(['partners.read']);
    expect(element.textContent).toContain('Chargement du tiers');
    httpMock().expectOne('/api/v1/partners/p-1/').flush(PARTNER);
    await stable();
    expect(element.querySelector('h1')?.textContent).toContain('Diallo et Cie');
    expect(element.textContent).toContain('FOU-007 · Fournisseur');
    expect(element.textContent).toContain('Actif');
    expect(element.textContent).toContain('Diallo et Compagnie SA');
    expect(element.textContent).toContain('contact@diallo.example');
    expect(element.textContent).toContain('30J — 30 jours');
    expect(TestBed.inject(BreadcrumbService).items().at(-1)?.label).toBe('FOU-007 — Diallo et Cie');
  });

  it('read only: no Modifier, no Actions', async () => {
    const { element, stable } = await open(['partners.read']);
    httpMock().expectOne('/api/v1/partners/p-1/').flush(PARTNER);
    await stable();
    expect(element.textContent).not.toContain('Modifier');
    expect(element.textContent).not.toContain('Actions');
  });

  it('deactivates after a confirmation; the answer of the server is shown', async () => {
    const { element, stable } = await open([
      'partners.read',
      'partners.update',
      'partners.disable',
    ]);
    httpMock().expectOne('/api/v1/partners/p-1/').flush(PARTNER);
    await stable();
    expect(element.querySelector('a[href$="/modifier"]')?.textContent).toContain('Modifier');
    const confirm = vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
    element.querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
    await stable();
    document.querySelector<HTMLElement>('[role=menuitem]')!.click();
    await stable();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Désactiver Diallo et Cie ?' }),
    );
    const request = httpMock().expectOne('/api/v1/partners/p-1/deactivate/');
    expect(request.request.method).toBe('POST');
    request.flush({ ...PARTNER, status: 'inactive' });
    await stable();
    expect(element.textContent).toContain('Inactif');
    expect(element.textContent).toContain('Ce tiers est désactivé');
  });

  it('smart buttons, each with its own permission: entries, ledger, accounts, lettering, due dates, history', async () => {
    const { element, stable } = await open([
      'partners.read',
      'accounting.read',
      'reporting.read_auxiliary',
      'audit.read',
    ]);
    httpMock().expectOne('/api/v1/partners/p-1/').flush(PARTNER);
    const entries = httpMock().expectOne((req) => req.url === '/api/v1/accounting/entries/');
    expect(entries.request.params.get('partner')).toBe('p-1');
    entries.flush({ count: 12, next: null, previous: null, results: [{}] });
    httpMock()
      .expectOne('/api/v1/accounting/partners/p-1/accounts/')
      .flush([
        {
          role: 'supplier',
          code: '401',
          account: { public_id: 'a-401', code: '401' },
          postable: true,
        },
      ]);
    // Lettering (V2.1 A4): the server's count of the partner's open lines.
    const lettering = httpMock().expectOne(
      (req) => req.url === '/api/v1/accounting/letterable-lines/',
    );
    expect(lettering.request.params.get('partner')).toBe('p-1');
    expect(lettering.request.params.get('status')).toBe('open');
    expect(lettering.request.params.get('page_size')).toBe('1');
    lettering.flush({ count: 3, next: null, previous: null, results: [{}] });
    // Due dates (V2.1 A5): the server's count of the partner's installments.
    const dues = httpMock().expectOne((req) => req.url === '/api/v1/accounting/due-items/');
    expect(dues.request.params.get('partner')).toBe('p-1');
    expect(dues.request.params.get('page_size')).toBe('1');
    dues.flush({ count: 5, next: null, previous: null, results: [{}] });
    await stable();
    httpMock()
      .expectOne((req) => req.url === '/api/v1/audit/objects/partners.partner/p-1/')
      .flush({ count: 2, next: null, previous: null, results: [] });
    await stable();
    httpMock().verify(); // one request per relation, never one per related object

    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a.smart'));
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Écritures : 12',
      'Grand livre auxiliaire',
      'Comptes collectifs : 1',
      'Échéances : 5',
      'Lettrage : 3',
      'Historique : 2',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/app/comptabilite/ecritures?tiers=FOU-007',
      '/app/comptabilite/analyse/grand-livre-auxiliaire?tiers=FOU-007',
      '/liste/p-1#comptes-collectifs',
      '/app/comptabilite/echeances?tiers=FOU-007',
      '/app/comptabilite/lettrage?tiers=FOU-007',
      '/liste/p-1#historique',
    ]);
    // No relation is disabled any more: Échéances and Lettrage have their API (A4, A5).
    expect(element.querySelectorAll('button.smart')).toHaveLength(0);
    const accounts = element.querySelector('#comptes-collectifs')!;
    expect(accounts.textContent).toMatch(/Compte fournisseur\s*401\s*·\s*imputable/);
    expect(accounts.querySelector('a')?.getAttribute('href')).toBe(
      '/app/comptabilite/plan-comptable/a-401',
    );
  });

  it('partners.read only: no accounting relation is asked nor shown', async () => {
    const { element, stable } = await open(['partners.read']);
    httpMock().expectOne('/api/v1/partners/p-1/').flush(PARTNER);
    await stable();
    httpMock().expectNone((req) => req.url.includes('/accounting/') || req.url.includes('/audit/'));
    expect(element.querySelector('.smart-buttons')).toBeNull();
    expect(element.querySelector('#comptes-collectifs')).toBeNull();
  });

  it('a partner of another company, or unknown: « n’existe pas ou plus »', async () => {
    const { element, stable } = await open(['partners.read']);
    httpMock()
      .expectOne('/api/v1/partners/p-1/')
      .flush(envelope('not_found'), { status: 404, statusText: 'x' });
    await stable();
    expect(element.textContent).toContain('Ce tiers n’existe pas ou plus dans cette société.');
    expect(element.textContent).toContain('Retour aux tiers');
  });
});
