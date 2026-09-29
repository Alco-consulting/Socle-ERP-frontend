import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AuthFailures } from '../http/auth-failures';
import { envelope, httpMock, provideHttpTesting, setCookie, clearCookie } from '../http/testing';
import { NotificationCenter } from '../notifications/notification-center';
import { SessionStore } from '../session/session.store';
import { CompanySummaryDto } from './company-api';
import { CompanyContextService, REFUSED_MESSAGE } from './company-context.service';

const A: CompanySummaryDto = {
  public_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  legal_name: 'Alco Guinée SARL',
  trade_name: 'ALCO GUINÉE',
  country: 'GN',
  reference_currency: 'GNF',
  status: 'active',
};
const B: CompanySummaryDto = {
  ...A,
  public_id: 'bbbbbbbb-0000-4000-8000-000000000002',
  legal_name: 'Filiale Sénégal SA',
  trade_name: '',
  country: 'SN',
  reference_currency: 'XOF',
};

function context(
  current: CompanySummaryDto | null,
  permissions: string[] = [],
  companies: CompanySummaryDto[] = [A, B],
  defaultCompany: string | null = A.public_id,
) {
  return {
    current: current ? { company: current, permissions } : null,
    default_company: defaultCompany,
    companies,
  };
}

/** Lets awaited promises move to their next request. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CompanyContextService (X-Company-ID, company context)', () => {
  let service: CompanyContextService;
  let store: SessionStore;
  let toasts: AlcoToastService;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    service = TestBed.inject(CompanyContextService);
    store = TestBed.inject(SessionStore);
    toasts = TestBed.inject(AlcoToastService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    store.load({ user: { displayName: 'T', email: 't@example.org' }, globalPermissions: [] });
    store.setStatus('authenticated');
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  const contextCall = () => httpMock().expectOne('/api/v1/company-context/');
  const messages = () => toasts.toasts().map((toast) => `${toast.tone}: ${toast.message}`);

  /** Session opened in company A (the default one). */
  async function openInA(permissions = ['accounting.read', 'treasury.read']): Promise<void> {
    const done = service.load();
    contextCall().flush(context(A, permissions));
    await done;
  }

  describe('opening of the session', () => {
    it('the default company, with the permissions the server gives in it', async () => {
      const done = service.load();
      const request = contextCall();
      expect(request.request.headers.has('X-Company-ID')).toBe(false); // server default
      request.flush(context(A, ['accounting.read']));
      await done;
      expect(service.companyId()).toBe(A.public_id);
      expect(store.activeCompany()).toEqual({
        id: A.public_id,
        name: 'ALCO GUINÉE',
        legalName: 'Alco Guinée SARL',
        country: 'GN',
        currency: 'GNF',
        active: true,
      });
      expect(store.companies().map((company) => company.name)).toEqual([
        'ALCO GUINÉE',
        'Filiale Sénégal SA', // legal name when no trade name
      ]);
      expect(store.defaultCompanyId()).toBe(A.public_id);
      expect(store.can('accounting.read')).toBe(true);
      expect(sessionStorage.getItem('alco.company')).toBe(A.public_id);
    });

    it('no default and several companies: none is chosen for the user', async () => {
      const done = service.load();
      contextCall().flush(context(null, [], [A, B], null));
      await done;
      expect(store.activeCompany()).toBeNull();
      expect(store.companies().length).toBe(2);
      expect(store.permissions().size).toBe(0);
    });

    it('no default and a single company: that one (there is nothing to choose)', async () => {
      const done = service.load();
      contextCall().flush(context(null, [], [B], null));
      await settle();
      const request = contextCall();
      expect(request.request.headers.get('X-Company-ID')).toBe(B.public_id);
      request.flush(context(B, ['reporting.read'], [B], null));
      await done;
      expect(service.companyId()).toBe(B.public_id);
      expect(store.can('reporting.read')).toBe(true);
    });

    it('no accessible company at all', async () => {
      const done = service.load();
      contextCall().flush(context(null, [], [], null));
      await done;
      expect(store.activeCompany()).toBeNull();
      expect(store.companies()).toEqual([]);
    });

    it('a reload stays in the company chosen in this tab (checked by the server)', async () => {
      sessionStorage.setItem('alco.company', B.public_id);
      const done = service.load();
      const request = contextCall();
      expect(request.request.headers.get('X-Company-ID')).toBe(B.public_id);
      request.flush(context(B, ['reporting.read']));
      await done;
      expect(service.companyId()).toBe(B.public_id);
    });

    it('a remembered company refused by the server: forgotten, said, the default one', async () => {
      sessionStorage.setItem('alco.company', B.public_id);
      const done = service.load();
      contextCall().flush(envelope('company_access_denied'), { status: 403, statusText: 'x' });
      await settle();
      const retry = contextCall();
      expect(retry.request.headers.has('X-Company-ID')).toBe(false);
      retry.flush(context(A, [], [A]));
      await done;
      expect(service.companyId()).toBe(A.public_id);
      expect(sessionStorage.getItem('alco.company')).toBe(A.public_id);
      expect(messages()).toEqual([`warning: ${REFUSED_MESSAGE}`]);
    });

    it('server unreachable: rejects, nothing chosen', async () => {
      const done = service.load();
      contextCall().error(new ProgressEvent('error'), { status: 0 });
      await expect(done).rejects.toMatchObject({ kind: 'network' });
      expect(store.activeCompany()).toBeNull();
    });

    it('an inactive company (platform administrator) says so', async () => {
      const inactive: CompanySummaryDto = { ...B, status: 'inactive' };
      const done = service.load();
      contextCall().flush(context(inactive, ['companies.read'], [A, inactive]));
      await done;
      expect(store.activeCompany()?.active).toBe(false);
    });
  });

  describe('switch (top bar)', () => {
    it('asks the server for that company, replaces the permissions, lands, says it', async () => {
      await openInA();
      TestBed.inject(NotificationCenter).load([{ id: 'n', title: 'A', detail: 'A', read: false }]);
      const changes: (string | undefined)[] = [];
      service.changed$.subscribe((company) => changes.push(company?.id));

      const done = service.switchTo(B.public_id);
      expect(store.activity()).toBe('switching-company'); // screens of A removed at once
      const request = contextCall();
      expect(request.request.headers.get('X-Company-ID')).toBe(B.public_id);
      request.flush(context(B, ['reporting.read']));
      await done;

      expect(service.companyId()).toBe(B.public_id);
      expect(store.can('reporting.read')).toBe(true);
      expect(store.can('accounting.read')).toBe(false); // nothing of A is kept
      expect(TestBed.inject(NotificationCenter).notifications()).toEqual([]);
      expect(changes).toEqual([B.public_id]);
      expect(navigate).toHaveBeenCalledWith('/app'); // from the launcher: the launcher
      expect(store.activity()).toBeNull();
      expect(messages()).toEqual(['info: Société active : Filiale Sénégal SA.']);
      expect(sessionStorage.getItem('alco.company')).toBe(B.public_id);
    });

    it('lands on the same menu screen when it is still open in the new company', async () => {
      await openInA();
      vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue(
        '/app/comptabilite/ecritures/proto-050',
      );
      const done = service.switchTo(B.public_id);
      contextCall().flush(context(B, ['accounting.read']));
      await done;
      expect(navigate).toHaveBeenCalledWith('/app/comptabilite/ecritures');
    });

    it('a refused company: said, the list refreshed, the current company kept', async () => {
      await openInA();
      const done = service.switchTo(B.public_id);
      contextCall().flush(envelope('company_access_denied'), { status: 403, statusText: 'x' });
      await settle();
      const refresh = contextCall();
      expect(refresh.request.headers.get('X-Company-ID')).toBe(A.public_id);
      refresh.flush(context(A, ['accounting.read'], [A]));
      await done;
      expect(service.companyId()).toBe(A.public_id);
      expect(store.companies().map((company) => company.id)).toEqual([A.public_id]);
      expect(messages()).toEqual([`warning: ${REFUSED_MESSAGE}`]);
      expect(navigate).not.toHaveBeenCalled();
      expect(store.activity()).toBeNull();
    });

    it('server unreachable: said, nothing changes', async () => {
      await openInA();
      const done = service.switchTo(B.public_id);
      contextCall().error(new ProgressEvent('error'), { status: 0 });
      await done;
      expect(service.companyId()).toBe(A.public_id);
      expect(store.can('accounting.read')).toBe(true);
      expect(messages()).toEqual([
        'danger: Le serveur ne répond pas. Vérifiez votre connexion internet puis réessayez.',
      ]);
      expect(store.activity()).toBeNull();
    });

    it('the session ended meanwhile: no message here (the login screen explains)', async () => {
      await openInA();
      const done = service.switchTo(B.public_id);
      contextCall().flush(envelope('not_authenticated'), { status: 403, statusText: 'x' });
      await done;
      expect(messages()).toEqual([]);
      expect(store.activity()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('the active company again, or a switch already running: nothing', async () => {
      await openInA();
      await service.switchTo(A.public_id);
      const first = service.switchTo(B.public_id);
      await service.switchTo(B.public_id); // ignored: one switch at a time
      contextCall().flush(context(B, []));
      await first;
    });
  });

  describe('the active company refused during work', () => {
    it('the list again, a valid company, its launcher', async () => {
      await openInA();
      TestBed.inject(AuthFailures).reportCompanyRefused(A.public_id);
      expect(store.activity()).toBe('switching-company');
      const refresh = contextCall();
      expect(refresh.request.headers.has('X-Company-ID')).toBe(false); // not A again
      refresh.flush(context(B, ['reporting.read'], [B], B.public_id));
      await settle();
      expect(service.companyId()).toBe(B.public_id);
      expect(store.can('accounting.read')).toBe(false);
      expect(messages()).toEqual([`warning: ${REFUSED_MESSAGE}`]);
      expect(navigate).toHaveBeenCalledWith('/app');
      expect(store.activity()).toBeNull();
    });

    it('several companies left, none by default: the choice of one', async () => {
      await openInA();
      TestBed.inject(AuthFailures).reportCompanyRefused(A.public_id);
      contextCall().flush(context(null, [], [B, { ...B, public_id: 'c' }], null));
      await settle();
      expect(store.activeCompany()).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/societe');
    });

    it('a refusal for another company than the active one is ignored', async () => {
      await openInA();
      TestBed.inject(AuthFailures).reportCompanyRefused(B.public_id);
      httpMock().expectNone('/api/v1/company-context/');
      expect(store.activity()).toBeNull();
    });
  });

  it('default company: PUT company-context/default/ with CSRF, then remembered', async () => {
    await openInA();
    setCookie('XSRF-TOKEN', 'tok');
    const done = service.setDefault(B.public_id);
    const request = httpMock().expectOne('/api/v1/company-context/default/');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ company: B.public_id });
    expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
    expect(request.request.headers.has('X-Company-ID')).toBe(false);
    request.flush({ default_company: B.public_id });
    await done;
    expect(store.defaultCompanyId()).toBe(B.public_id);
  });

  it('end of session: the company of the tab is forgotten', async () => {
    await openInA();
    service.forget();
    expect(sessionStorage.getItem('alco.company')).toBeNull();
  });
});
