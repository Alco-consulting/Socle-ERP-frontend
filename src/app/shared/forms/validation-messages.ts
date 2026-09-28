import { ValidationErrors } from '@angular/forms';

/**
 * Human messages for the validation errors used by the application's forms.
 * A server-side error attached to a control with `setErrors({ server: 'message' })`
 * is shown as is.
 */
export function validationMessage(errors: ValidationErrors | null): string | null {
  if (!errors) {
    return null;
  }
  if (typeof errors['server'] === 'string') {
    return errors['server'];
  }
  if (errors['required']) {
    return 'Ce champ est obligatoire.';
  }
  if (errors['maxlength']) {
    const { requiredLength } = errors['maxlength'] as { requiredLength: number };
    return `${requiredLength} caractères au maximum.`;
  }
  if (errors['decimal']) {
    const { maxDecimals } = errors['decimal'] as { maxDecimals: number };
    return maxDecimals === 0
      ? 'Saisissez un montant sans décimales (ex. 150000).'
      : `Saisissez un montant avec ${maxDecimals} décimales au plus (ex. 1250,50).`;
  }
  return 'Valeur invalide.';
}
