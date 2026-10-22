import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { attachmentName } from '../../core/http/api-client';
import { clearCookie, httpMock, provideHttpTesting, setCookie } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../core/session/testing';
import { TransfersApi } from './transfers-api';

describe('TransfersApi (imports-exports/)', () => {
  let api: TransfersApi;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    openTestSession(TestBed.inject(SessionStore));
    api = TestBed.inject(TransfersApi);
    setCookie('XSRF-TOKEN', 'tok');
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('every import step is its own server command', () => {
    const steps: [() => unknown, string, unknown][] = [
      [() => api.createImport('partners'), 'imports/', { import_type: 'partners' }],
      [
        () => api.parse('r1', { encoding: 'utf-8', delimiter: ';' }),
        'imports/r1/parse/',
        { encoding: 'utf-8', delimiter: ';' },
      ],
      [
        () => api.map('r1', { code: 'Code' }, { date_format: '%d/%m/%Y' }),
        'imports/r1/map/',
        { columns: { code: 'Code' }, options: { date_format: '%d/%m/%Y' } },
      ],
      [() => api.validate('r1'), 'imports/r1/validate/', null],
      [() => api.preview('r1'), 'imports/r1/preview/', null],
      [() => api.execute('r1'), 'imports/r1/execute/', { asynchronous: false }],
      [() => api.cancel('r1', 'Abandon'), 'imports/r1/cancel/', { reason: 'Abandon' }],
    ];
    for (const [call, path, body] of steps) {
      void firstValueFrom(call() as never);
      const request = httpMock().expectOne(`/api/v1/imports-exports/${path}`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(body);
      expect(request.request.headers.get('X-XSRF-TOKEN')).toBe('tok');
      expect(request.request.headers.get('X-Company-ID')).toBe(TEST_COMPANY.id);
      request.flush({});
    }
  });

  it('the file is sent as multipart, field « file »', () => {
    const file = new File(['code,name\n'], 'tiers.csv', { type: 'text/csv' });
    void firstValueFrom(api.upload('r1', file));
    const request = httpMock().expectOne('/api/v1/imports-exports/imports/r1/upload/');
    const body = request.request.body as FormData;
    expect(body.get('file')).toBeInstanceOf(File);
    expect(request.request.headers.has('Content-Type')).toBe(false); // the browser's boundary
    request.flush({});
  });

  it('refused rows: one page of the report', () => {
    void firstValueFrom(api.rows('r1', 'error'));
    const request = httpMock().expectOne(
      (req) => req.url === '/api/v1/imports-exports/imports/r1/rows/',
    );
    expect(request.request.params.get('status')).toBe('error');
    request.flush({ count: 0, next: null, previous: null, results: [] });
  });

  it('export: synchronous, with the parameters the type accepts; then the file', async () => {
    void firstValueFrom(api.createExport('partners', { role: 'customer' }));
    const request = httpMock().expectOne('/api/v1/imports-exports/exports/');
    expect(request.request.body).toEqual({
      export_type: 'partners',
      file_format: 'csv',
      parameters: { role: 'customer' },
      asynchronous: false,
    });
    request.flush({});

    const file = firstValueFrom(api.download('e1'));
    const download = httpMock().expectOne('/api/v1/imports-exports/exports/e1/download/');
    expect(download.request.responseType).toBe('blob');
    download.flush(new Blob(['code\n']), {
      headers: { 'Content-Disposition': 'attachment; filename="tiers-2026.csv"' },
    });
    expect((await file).filename).toBe('tiers-2026.csv');
  });

  it('reads the file name of Content-Disposition', () => {
    expect(attachmentName('attachment; filename="a b.csv"')).toBe('a b.csv');
    expect(attachmentName("attachment; filename*=UTF-8''tiers%C3%A9.csv")).toBe('tiersé.csv');
    expect(attachmentName(null)).toBeNull();
  });
});
