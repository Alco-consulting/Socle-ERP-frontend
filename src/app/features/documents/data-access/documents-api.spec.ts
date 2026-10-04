import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../../core/http/testing';
import { SessionStore } from '../../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../../core/session/testing';
import { AuditApi } from '../../audit/data-access/audit-api';
import { DocumentsApi } from './documents-api';

describe('DocumentsApi and AuditApi (attached to a resource of a domain)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    openTestSession(TestBed.inject(SessionStore), { permissions: ['documents.read'] });
    setCookie('XSRF-TOKEN', 'tok');
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('lists the documents of one resource', () => {
    void firstValueFrom(TestBed.inject(DocumentsApi).attachedTo('accounting.entry', 'e-1'));
    const request = httpMock().expectOne((req) => req.url === '/api/v1/documents/');
    expect(request.request.params.get('resource_type')).toBe('accounting.entry');
    expect(request.request.params.get('resource_id')).toBe('e-1');
    expect(request.request.headers.get('X-Company-ID')).toBe(TEST_COMPANY.id);
    request.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('uploads a file as multipart, with the resource it belongs to', () => {
    const file = new File(['%PDF'], 'facture.pdf', { type: 'application/pdf' });
    void firstValueFrom(TestBed.inject(DocumentsApi).upload('accounting.entry', 'e-1', file));
    const request = httpMock().expectOne('/api/v1/documents/');
    const body = request.request.body as FormData;
    expect(request.request.method).toBe('POST');
    expect((body.get('file') as File).name).toBe('facture.pdf');
    expect(body.get('resource_type')).toBe('accounting.entry');
    expect(body.get('resource_id')).toBe('e-1');
    expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
    request.flush({});
  });

  it('asks the server for a short-lived download link', () => {
    void firstValueFrom(TestBed.inject(DocumentsApi).downloadLink('d-1'));
    httpMock()
      .expectOne('/api/v1/documents/d-1/download/')
      .flush({ url: 'https://files.example.org/x', expires_at: '', expires_in: 300 });
  });

  it('reads the audit history of one object', () => {
    void firstValueFrom(TestBed.inject(AuditApi).history('accounting.journalentry', 'e-1'));
    const request = httpMock().expectOne(
      (req) => req.url === '/api/v1/audit/objects/accounting.journalentry/e-1/',
    );
    expect(request.request.params.get('page_size')).toBe('50');
    request.flush({ count: 0, next: null, previous: null, results: [] });
  });
});
