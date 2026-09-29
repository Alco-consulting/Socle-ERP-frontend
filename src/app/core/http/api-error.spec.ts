import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

import { ApiError, toApiError } from './api-error';
import { envelope } from './testing';

function response(status: number, body: unknown = null, headers?: HttpHeaders) {
  return new HttpErrorResponse({ status, error: body, headers, url: '/api/v1/x/' });
}

describe('toApiError', () => {
  it('reads the backend envelope: code, message, details, correlation id', () => {
    const error = toApiError(
      response(400, {
        error: {
          code: 'validation_error',
          message: 'Invalid input.',
          details: { email: [{ message: 'Enter a valid email address.', code: 'invalid' }] },
          correlation_id: 'abc-123',
        },
      }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('bad-request');
    expect(error.status).toBe(400);
    expect(error.code).toBe('validation_error');
    expect(error.correlationId).toBe('abc-123');
    expect(error.fieldErrors['email'][0].code).toBe('invalid');
  });

  it.each([
    [0, null, 'network'],
    [400, 'company_required', 'bad-request'],
    [401, null, 'unauthenticated'],
    [403, 'not_authenticated', 'unauthenticated'],
    [403, 'permission_denied', 'forbidden'],
    [403, 'company_permission_denied', 'forbidden'],
    [403, 'csrf_failed', 'forbidden'],
    [404, 'not_found', 'not-found'],
    [409, null, 'bad-request'],
    [429, 'throttled', 'throttled'],
    [500, 'server_error', 'server'],
    [502, null, 'unavailable'],
    [503, 'unavailable', 'unavailable'],
    [504, null, 'unavailable'],
  ] as const)('HTTP %s (%s) → %s', (status, code, kind) => {
    const error = toApiError(response(status, code ? envelope(code) : '<html>proxy</html>'));
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
  });

  it('a 403 permission refusal is not an end of session', () => {
    expect(toApiError(response(403, envelope('permission_denied'))).kind).not.toBe(
      'unauthenticated',
    );
  });

  it('never invents a backend code when the server sent no envelope', () => {
    expect(toApiError(response(502, '<html>Bad gateway</html>')).code).toBeNull();
  });

  it('reads Retry-After on 429', () => {
    const error = toApiError(
      response(429, envelope('throttled'), new HttpHeaders({ 'Retry-After': '42' })),
    );
    expect(error.retryAfter).toBe(42);
  });

  it('timeout and unknown failures', () => {
    expect(toApiError(new TimeoutError()).kind).toBe('timeout');
    expect(toApiError(new Error('boom')).kind).toBe('network');
    const original = toApiError(response(404, envelope('not_found')));
    expect(toApiError(original)).toBe(original);
  });
});
