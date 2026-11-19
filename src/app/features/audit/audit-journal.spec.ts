import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { openTestSession } from '../../core/session/testing';
import { AuditEventPage } from './audit-event';
import { AuditJournalPage } from './audit-journal';
import { valueText } from './audit-presentation';
import { AuditEvent } from './data-access/audit-api';

const EVENTS = '/api/v1/audit/events/';
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const page = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

function event(extra: Partial<AuditEvent> = {}): AuditEvent {
  return {
    public_id: 'ev-1',
    occurred_at: '2026-03-10T09:30:00Z',
    action: 'validate',
    object_type: 'accounting.journalentry',
    object_id: 'en-1',
    object_label: 'VTE-000101',
    user: { public_id: 'u-1', email: 'comptable@example.org' },
    origin: 'http',
    source: '',
    correlation_id: 'c-1',
    metadata: {},
    changed_fields: ['status'],
    before: null,
    after: null,
    ...extra,
  };
}

async function open(url: string) {
  TestBed.configureTestingModule({
    providers: [
      ...provideHttpTesting(),
      provideRouter([
        {
          path: 'journal',
          children: [
            { path: '', component: AuditJournalPage },
            { path: ':id', component: AuditEventPage },
          ],
        },
      ]),
    ],
  });
  openTestSession(TestBed.inject(SessionStore), { permissions: ['audit.read'] });
  setCookie('XSRF-TOKEN', 'tok');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  const element = harness.routeNativeElement as HTMLElement;
  const stable = async () => {
    await settle();
    await harness.fixture.whenStable();
  };
  return { element, stable };
}

describe('Journal d’audit: values', () => {
  it('says nothing as a dash, a flag in words, a structure as is', () => {
    expect(valueText(null)).toBe('—');
    expect(valueText('')).toBe('—');
    expect(valueText(true)).toBe('Oui');
    expect(valueText('posted')).toBe('posted');
    expect(valueText({ code: 'X' })).toBe('{"code":"X"}');
  });
});

describe('Journal d’audit', () => {
  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('who did what and when, the object linked to its record', async () => {
    const { element, stable } = await open('/journal');
    httpMock()
      .expectOne((req) => req.url === EVENTS)
      .flush(page([event()]));
    await stable();

    const text = element.textContent ?? '';
    expect(text).toContain('comptable@example.org');
    expect(text).toContain('Validation');
    expect(text).toContain('Écriture');
    const link = Array.from(element.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('VTE-000101'),
    );
    expect(link?.getAttribute('href')).toBe('/app/comptabilite/ecritures/en-1');
  });

  it('a filter asks the server again, from the first page', async () => {
    const { element, stable } = await open('/journal');
    httpMock()
      .expectOne((req) => req.url === EVENTS)
      .flush(page([]));
    await stable();
    const action = element.querySelector<HTMLSelectElement>('select[formcontrolname=action]')!;

    action.value = 'validate';
    action.dispatchEvent(new Event('change'));
    await stable();

    const request = httpMock().expectOne((req) => req.url === EVENTS);
    expect(request.request.params.get('action')).toBe('validate');
    expect(request.request.params.get('page')).toBeNull();
    request.flush(page([]));
    await stable();
    expect(element.textContent).toContain('Aucun événement ne correspond à ces filtres.');
  });

  it('an event: each field changed, before and after, for those who may see them', async () => {
    const { element, stable } = await open('/journal/ev-1');
    httpMock()
      .expectOne(`${EVENTS}ev-1/`)
      .flush(event({ before: { status: 'submitted' }, after: { status: 'validated' } }));
    await stable();

    const cells = Array.from(element.querySelectorAll('.changes tbody td')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(cells).toEqual(['submitted', 'validated']);
    expect(element.textContent).toContain('Un utilisateur, depuis l’application');
  });

  it('without the right to see the values: only the fields changed', async () => {
    const { element, stable } = await open('/journal/ev-1');
    httpMock().expectOne(`${EVENTS}ev-1/`).flush(event());
    await stable();

    expect(element.querySelector('.changes')).toBeNull();
    expect(element.textContent).toContain('Votre profil ne permet pas de voir les valeurs');
    expect(element.textContent).toContain('status');
  });
});
