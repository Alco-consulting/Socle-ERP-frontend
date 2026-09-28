import { ApiErrorBody, toUserError } from './user-error';

const envelope = (code: string): ApiErrorBody => ({
  error: { code, message: 'Technical message (translated, unstable).', correlation_id: 'abc-123' },
});

describe('toUserError', () => {
  it('uses the feature catalog first, keyed by the stable code', () => {
    const error = toUserError(envelope('accounting_entry_unbalanced'), {
      accounting_entry_unbalanced: { title: 'Impossible de valider.', message: 'Débit ≠ crédit.' },
    });
    expect(error.title).toBe('Impossible de valider.');
    expect(error.code).toBe('accounting_entry_unbalanced');
    expect(error.correlationId).toBe('abc-123');
  });

  it('falls back to the generic messages of the API', () => {
    expect(toUserError(envelope('permission_denied')).title).toBe(
      'Vous n’avez pas le droit d’effectuer cette action.',
    );
  });

  it('never shows the technical code as the message of an unknown error', () => {
    const error = toUserError(envelope('accounting_something_new'));
    expect(error.title).toBe('Une erreur inattendue s’est produite.');
    expect(error.title).not.toContain('accounting_');
    expect(error.code).toBe('accounting_something_new');
  });

  it('treats anything without the envelope as a network failure', () => {
    expect(toUserError(new Error('Failed to fetch')).code).toBe('network');
    expect(toUserError(undefined).title).toBe('Le serveur ne répond pas.');
  });
});
