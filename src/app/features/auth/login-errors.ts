import { ErrorCatalog } from '../../core/errors/user-error';
import { FieldMessageOverrides } from '../../core/errors/field-errors';

/**
 * Messages of the login screen, by API code. `invalid_credentials` covers an unknown
 * address, a wrong password AND a disabled account: the API answers the same on purpose, so
 * that nobody can learn whether an account exists.
 */
export const LOGIN_ERRORS: ErrorCatalog = {
  invalid_credentials: {
    title: 'Adresse e-mail ou mot de passe incorrect.',
    message: 'Vérifiez vos identifiants puis réessayez.',
  },
  throttled: {
    title: 'Trop de tentatives.',
    message: 'Veuillez patienter avant de réessayer.',
  },
  unavailable: {
    title: 'Le service est momentanément indisponible.',
    message: 'Veuillez réessayer dans quelques instants.',
  },
};

export const LOGIN_FIELD_MESSAGES: FieldMessageOverrides = {
  email: { invalid: 'Saisissez une adresse e-mail valide.' },
};

export function waitMessage(seconds: number): string {
  return seconds > 1
    ? `Veuillez patienter ${seconds} secondes avant de réessayer.`
    : 'Veuillez patienter une seconde avant de réessayer.';
}
