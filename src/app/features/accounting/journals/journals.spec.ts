import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  clearCookie,
  envelope,
  httpMock,
  provideHttpTesting,
  setCookie,
} from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Journal } from '../data-access/accounting-models';
import { JournalDetailPage } from './journal-detail';
import { JournalFormPage } from './journal-form';
import { JournalListPage } from './journal-list';

const JOURNAL: Journal = {
  public_id: 'j-ach',
  code: 'ACH',
  name: 'Achats',
  journal_type: 'purchase',
  default_currency: null,
  sequence_prefix: 'ACH-',
  sequence_padding: 6,
  status: 'active',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};
const page = (results: unknown[] = [], count = results.length) => ({
  count,
  next: null,
  previous: null,
  results,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const READ = ['accounting.read'];
const MANAGE = ['accounting.read', 'accounting.manage_journals'];

describe('Journaux (accounting/journals/)', () => {
  async function open(url: string, permissions: string[]) {
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        provideRouter([
          {
            path: 'journaux',
            data: { breadcrumb: 'Journaux' },
            children: [
              { path: '', component: JournalListPage },
              { path: 'nouveau', component: JournalFormPage },
              {
                path: ':id',
                data: { breadcrumb: 'Journal' },
                children: [
                  { path: '', component: JournalDetailPage },
                  { path: 'modifier', component: JournalFormPage },
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
    const journals = () =>
      httpMock().expectOne((req) => req.url === '/api/v1/accounting/journals/');
    const currencies = () =>
      httpMock()
        .match((req) => req.url === '/api/v1/currencies/')
        .forEach((request) =>
          request.flush(page([{ code: 'GNF', name: 'Franc guinéen', status: 'active' }])),
        );
    return { harness, element, stable, journals, currencies };
  }

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  describe('list', () => {
    it('the URL is the query: type, state, exact code, page', async () => {
      const { journals } = await open('/journaux?type=bank&etat=active&code=BQ1&page=2', READ);
      const request = journals();
      const params = request.request.params;
      expect(params.get('journal_type')).toBe('bank');
      expect(params.get('status')).toBe('active');
      expect(params.get('code')).toBe('BQ1');
      expect(params.get('page')).toBe('2');
      request.flush(page([JOURNAL], 60));
    });

    it('rows of the API; « Nouveau journal » only with manage_journals', async () => {
      const reader = await open('/journaux', READ);
      reader.journals().flush(page([JOURNAL]));
      await reader.stable();
      const cells = Array.from(reader.element.querySelectorAll('tbody td')).map((cell) =>
        cell.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(cells).toEqual([
        'ACH',
        'Achats',
        'Achats',
        'Devise de la société',
        'ACH- · 6 chiffres',
        'Actif',
      ]);
      expect(reader.element.textContent).not.toContain('Nouveau journal');

      TestBed.resetTestingModule();
      const manager = await open('/journaux', MANAGE);
      manager.journals().flush(page([JOURNAL]));
      await manager.stable();
      expect(manager.element.textContent).toContain('Nouveau journal');
    });

    it('no permission in this company: a clear refusal', async () => {
      const { journals, element, stable } = await open('/journaux', READ);
      journals().flush(envelope('company_permission_denied'), { status: 403, statusText: 'x' });
      await stable();
      expect(element.textContent).toContain(
        'Vous n’avez pas accès à la comptabilité de cette société.',
      );
    });
  });

  describe('record', () => {
    it('shows the journal; deactivates after a confirmation (manage_journals)', async () => {
      const { element, stable } = await open('/journaux/j-ach', MANAGE);
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      await stable();
      expect(element.querySelector('h1')?.textContent).toContain('Achats');
      expect(element.textContent).toContain('ACH · Achats');
      vi.spyOn(TestBed.inject(AlcoConfirmService), 'confirm').mockResolvedValue(true);
      element.querySelector<HTMLButtonElement>('alco-dropdown button')!.click();
      await stable();
      document.querySelector<HTMLElement>('[role=menuitem]')!.click();
      await stable();
      httpMock()
        .expectOne('/api/v1/accounting/journals/j-ach/deactivate/')
        .flush({ ...JOURNAL, status: 'inactive' });
      await stable();
      expect(element.textContent).toContain('Inactif');
    });

    it('read only: no Modifier, no Actions', async () => {
      const { element, stable } = await open('/journaux/j-ach', READ);
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      await stable();
      expect(element.textContent).not.toContain('Modifier');
      expect(element.querySelector('alco-dropdown')).toBeNull();
    });
  });

  describe('form', () => {
    function fill(element: HTMLElement, name: string, value: string) {
      const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[formControlName="${name}"]`,
      )!;
      field.value = value;
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
    }
    const submit = (element: HTMLElement) =>
      element.querySelector('form')!.dispatchEvent(new Event('submit'));

    it('creation: the fields of the contract; a used code goes under the code', async () => {
      const { element, stable, currencies } = await open('/journaux/nouveau', MANAGE);
      currencies();
      await stable();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fill(element, 'code', 'VTE');
      fill(element, 'name', 'Ventes');
      fill(element, 'journal_type', 'sales');
      submit(element);
      await stable();
      const create = httpMock().expectOne('/api/v1/accounting/journals/');
      expect(create.request.body).toEqual({
        code: 'VTE',
        name: 'Ventes',
        journal_type: 'sales',
        default_currency: null,
        sequence_prefix: '',
      });
      create.flush(envelope('accounting_journal_code_exists'), { status: 400, statusText: 'x' });
      await stable();
      expect(element.textContent).toContain('Ce code est déjà utilisé par un autre journal.');

      fill(element, 'code', 'VTE2'); // the server's error stays until the code changes
      submit(element);
      await stable();
      httpMock()
        .expectOne('/api/v1/accounting/journals/')
        .flush({ ...JOURNAL, public_id: 'j-vte', code: 'VTE' });
      await stable();
      expect(navigate).toHaveBeenCalledWith(['/app/comptabilite/journaux', 'j-vte']);
    });

    it('modification: only the changes, never the code; a numbering in use is said', async () => {
      const { element, stable, currencies } = await open('/journaux/j-ach/modifier', MANAGE);
      currencies();
      httpMock().expectOne('/api/v1/accounting/journals/j-ach/').flush(JOURNAL);
      await stable();
      expect(element.querySelector('[formControlName="code"]')).toBeNull();
      fill(element, 'sequence_prefix', 'AC-');
      submit(element);
      await stable();
      const patch = httpMock().expectOne('/api/v1/accounting/journals/j-ach/');
      expect(patch.request.method).toBe('PATCH');
      expect(patch.request.body).toEqual({ sequence_prefix: 'AC-' });
      patch.flush(envelope('accounting_journal_numbering_in_use'), {
        status: 400,
        statusText: 'x',
      });
      await stable();
      expect(element.textContent).toContain('sa numérotation ne change plus');
    });
  });
});
