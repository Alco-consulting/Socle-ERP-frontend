import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { ApiClient, Paginated } from './api-client';
import { REQUEST_TIMEOUT } from './http-context';
import { clearCookie, httpMock, provideHttpTesting, setCookie } from './testing';

describe('ApiClient', () => {
  let api: ApiClient;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTesting() });
    api = TestBed.inject(ApiClient);
    setCookie('XSRF-TOKEN', 'csrf-token-1');
  });

  afterEach(() => {
    httpMock().verify();
    clearCookie('XSRF-TOKEN');
  });

  it('GET: relative path under the API base, query params without empty values', async () => {
    const result = firstValueFrom(
      api.get<Paginated<{ id: string }>>('companies/', {
        params: { page: 2, page_size: 50, search: 'démo', status: null, tag: ['a', 'b'] },
      }),
    );
    const request = httpMock().expectOne((r) => r.url === '/api/v1/companies/');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('search')).toBe('démo');
    expect(request.request.params.has('status')).toBe(false);
    expect(request.request.params.getAll('tag')).toEqual(['a', 'b']);
    request.flush({ count: 1, next: null, previous: null, results: [{ id: 'x' }] });
    expect((await result).results).toEqual([{ id: 'x' }]);
  });

  it.each(['post', 'put', 'patch'] as const)('%s sends a JSON body', async (method) => {
    const result = firstValueFrom(api[method]<{ ok: boolean }>('things/1/', { name: 'A' }));
    const request = httpMock().expectOne('/api/v1/things/1/');
    expect(request.request.method).toBe(method.toUpperCase());
    expect(request.request.body).toEqual({ name: 'A' });
    request.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('DELETE', async () => {
    const result = firstValueFrom(api.delete('things/1/'));
    const request = httpMock().expectOne('/api/v1/things/1/');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBeNull();
  });

  it('multipart upload: FormData body, no forced Content-Type, longer timeout', async () => {
    const data = new FormData();
    data.append('file', new Blob(['a;b\n1;2'], { type: 'text/csv' }), 'import.csv');
    const result = firstValueFrom(
      api.upload<{ id: string }>('imports-exports/imports/1/upload/', data),
    );
    const request = httpMock().expectOne('/api/v1/imports-exports/imports/1/upload/');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBe(data);
    expect(request.request.headers.has('Content-Type')).toBe(false);
    expect(request.request.context.get(REQUEST_TIMEOUT)).toBe(5_000);
    request.flush({ id: '1' });
    expect(await result).toEqual({ id: '1' });
  });
});
