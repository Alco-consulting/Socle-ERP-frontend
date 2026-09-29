import { ApiError } from '../http/api-error';

/** Human messages for the field error codes of DRF (`validation_error` details). */
const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  required: 'Ce champ est obligatoire.',
  blank: 'Ce champ est obligatoire.',
  null: 'Ce champ est obligatoire.',
  invalid: 'Valeur invalide.',
  max_length: 'Valeur trop longue.',
  min_length: 'Valeur trop courte.',
};

/** Field → code → message, when a form knows better (« Saisissez une adresse e-mail valide. »). */
export type FieldMessageOverrides = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * The first error of each field of a `validation_error`, as a human message chosen from its
 * stable code (never the server's translated text). `non_field_errors` is left to the
 * general message of the form.
 */
export function serverFieldErrors(
  error: ApiError,
  overrides: FieldMessageOverrides = {},
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [field, errors] of Object.entries(error.fieldErrors)) {
    const code = errors[0]?.code;
    if (field === 'non_field_errors' || !code) {
      continue;
    }
    result[field] = overrides[field]?.[code] ?? FIELD_MESSAGES[code] ?? 'Valeur invalide.';
  }
  return result;
}
