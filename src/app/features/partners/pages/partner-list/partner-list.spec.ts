import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestRequest } from '@angular/common/http/testing';

import { envelope, httpMock, provideHttpTesting } from '../../../../core/http/testing';
import { SessionStore } from '../../../../core/session/session.store';
import { openTestSession } from '../../../../core/session/testing';
import { PartnerSummary } from '../../data-access/partner-models';
import { PartnerListPage } from './partner-list';

const ROW: PartnerSummary = {
  public_id: 'p-1',
  code: 'CLI-001',
  name: 'Dupont SARL',
  legal_name: 'Dupont et fils SARL',
  is_customer: true,
  is_supplier: true,
  country: 'GN',
  tax_identifier: 'NIF-1',
  status: 'inactive',
};

const page = (results: PartnerSummary[], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});

describe('PartnerListPage (server-side list)', () => {
  async function open(url: string, permissions = ['partners.read', 'partners.create']) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          { path: 'liste', component: PartnerListPage, data: { breadcrumb: 'Tous les contacts' } },
          {
            path: 'clients',
            component: PartnerListPage,
            data: { breadcrumb: 'Clients', role: 'customer' },
          },
        ]),
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { permissions });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    // The tags of the filter (note backend 0045).
    httpMock()
      .match((req) => req.url === '/api/v1/partners/tags/')
      .forEach((request) => request.flush({ count: 0, next: null, previous: null, results: [] }));
    const element = harness.routeNativeElement as HTMLElement;
    const pending = (): TestRequest =>
      httpMock().expectOne((req) => req.url === '/api/v1/partners/');
    const answer = async (body: object, status = 200) => {
      pending().flush(body, { status, statusText: 'x' });
      await harness.fixture.whenStable();
    };
    return { harness, element, pending, answer };
  }

  afterEach(() => httpMock().verify());

  it('asks the first page to the server and shows its rows', async () => {
    const { element, pending, harness } = await open('/liste');
    expect(element.querySelector('[role=status]')?.textContent).toContain(
      'Chargement des contacts',
    );
    const request = pending();
    expect(request.request.params.get('page_size')).toBe('20');
    expect(request.request.params.has('page')).toBe(false);
    request.flush(page([ROW], 45));
    await harness.fixture.whenStable();

    const cells = Array.from(element.querySelectorAll('tbody td')).map((cell) =>
      cell.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(cells).toEqual([
      'CLI-001',
      'Dupont SARL, Dupont et fils SARL',
      'Client et fournisseur',
      'GN',
      'NIF-1',
      'Inactif',
    ]);
    expect(element.querySelector('a.code')?.getAttribute('href')).toBe('/liste/p-1');
    expect(element.textContent).toContain('1–20 sur 45');
  });

  it('the URL is the query: search, state, role, country and page go to the server', async () => {
    const { pending } = await open('/liste?q=dupont&etat=inactive&role=supplier&pays=gn&page=2');
    const request = pending();
    const params = request.request.params;
    expect(params.get('search')).toBe('dupont');
    expect(params.get('status')).toBe('inactive');
    expect(params.get('role')).toBe('supplier');
    expect(params.get('country')).toBe('GN');
    expect(params.get('page')).toBe('2');
    request.flush(page([]));
  });

  it('a screen of one role (Clients) always asks that role', async () => {
    const { pending, harness, element } = await open('/clients?role=supplier');
    const request = pending();
    expect(request.request.params.get('role')).toBe('customer');
    request.flush(page([ROW]));
    await harness.fixture.whenStable();
    element.querySelector<HTMLButtonElement>('button[aria-haspopup=dialog]')?.click();
    expect(document.body.textContent).not.toContain('Tous les rôles');
  });

  it('empty company: says so, and offers the creation only with the permission', async () => {
    const allowed = await open('/liste');
    await allowed.answer(page([]));
    expect(allowed.element.textContent).toContain('Aucun contact trouvé.');
    expect(
      Array.from(allowed.element.querySelectorAll('a')).map((link) => link.textContent?.trim()),
    ).toEqual(['Nouveau contact', 'Créer un contact']);

    TestBed.resetTestingModule();
    const reader = await open('/liste', ['partners.read']);
    await reader.answer(page([]));
    expect(reader.element.textContent).toContain('Aucun contact trouvé.');
    expect(reader.element.querySelectorAll('a').length).toBe(0);
  });

  it('no match for the criteria: offers to reset them', async () => {
    const { answer, element } = await open('/liste?q=zzz');
    await answer(page([]));
    expect(element.textContent).toContain('Aucun contact ne correspond à ces critères.');
    expect(element.textContent).toContain('Réinitialiser les filtres');
  });

  it('no permission in this company: a clear refusal', async () => {
    const { answer, element } = await open('/liste');
    await answer(envelope('company_permission_denied'), 403);
    expect(element.textContent).toContain('Vous n’avez pas accès aux contacts de cette société.');
  });

  it('server unavailable: a human message and a retry', async () => {
    const { answer, element, pending, harness } = await open('/liste');
    await answer(envelope('unavailable'), 503);
    expect(element.textContent).toContain('Le service est momentanément indisponible.');
    element
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => button.textContent?.includes('Réessayer') && button.click());
    pending().flush(page([ROW]));
    await harness.fixture.whenStable();
    expect(element.textContent).toContain('CLI-001');
  });

  it('a page that no longer exists: back to the first one', async () => {
    const { answer, pending } = await open('/liste?page=9');
    await answer(envelope('not_found'), 404);
    const again = pending();
    expect(again.request.params.has('page')).toBe(false);
    again.flush(page([ROW]));
    expect(TestBed.inject(Router).url).toBe('/liste');
  });
});
