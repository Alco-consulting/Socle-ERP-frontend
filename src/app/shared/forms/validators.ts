import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { normalizeDecimalInput } from '../utils/decimal';

/**
 * A format of input (country code, phone…) with its own message. Ergonomics only: the
 * server keeps the final word on every value.
 */
export function inputFormat(pattern: RegExp, message: string): ValidatorFn {
  return (control: AbstractControl<string | null>): ValidationErrors | null => {
    const value = control.value?.trim() ?? '';
    return value === '' || pattern.test(value) ? null : { format: message };
  };
}

/**
 * Input format only (digits, one decimal mark, at most `maxDecimals` decimals).
 * Whether the amount is acceptable for accounting stays the server's decision.
 */
export function decimalFormat(maxDecimals: number): ValidatorFn {
  return (control: AbstractControl<string | null>): ValidationErrors | null => {
    const raw = control.value;
    if (raw === null || raw.trim() === '') {
      return null;
    }
    const normalized = normalizeDecimalInput(raw);
    const decimals = normalized?.split('.')[1]?.length ?? 0;
    if (normalized === null || normalized.startsWith('-') || decimals > maxDecimals) {
      return { decimal: { maxDecimals } };
    }
    return null;
  };
}
