import { ApiError } from '../http/api-error';
import { serverFieldErrors } from './field-errors';

const validation = (details: unknown) =>
  new ApiError('bad-request', 400, 'validation_error', 'Invalid input.', details);

describe('serverFieldErrors', () => {
  it('turns field codes into human messages, never the server text', () => {
    const error = validation({
      email: [{ message: 'Saisissez une adresse e-mail valide (serveur).', code: 'invalid' }],
      password: [{ message: 'Ce champ ne peut être vide.', code: 'blank' }],
    });
    expect(serverFieldErrors(error)).toEqual({
      email: 'Valeur invalide.',
      password: 'Ce champ est obligatoire.',
    });
  });

  it('lets a form give a better message for a field', () => {
    const error = validation({ email: [{ message: 'x', code: 'invalid' }] });
    expect(
      serverFieldErrors(error, { email: { invalid: 'Saisissez une adresse e-mail valide.' } }),
    ).toEqual({
      email: 'Saisissez une adresse e-mail valide.',
    });
  });

  it('leaves non-field errors and other errors to the general message', () => {
    expect(
      serverFieldErrors(validation({ non_field_errors: [{ message: 'x', code: 'invalid' }] })),
    ).toEqual({});
    expect(serverFieldErrors(new ApiError('bad-request', 400, 'invalid_credentials', 'x'))).toEqual(
      {},
    );
  });
});
