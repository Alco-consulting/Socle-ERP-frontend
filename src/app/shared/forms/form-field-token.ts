import { InjectionToken, Signal } from '@angular/core';
import { ValidationErrors } from '@angular/forms';

export interface ControlState {
  readonly invalid: boolean;
  readonly touched: boolean;
  readonly errors: ValidationErrors | null;
}

/** What a field reads of the control projected inside it (`AlcoInput`, `AlcoAutocomplete`). */
export interface FieldControl {
  readonly state: Signal<ControlState>;
  showsError(): boolean;
}

/** Contract between `<alco-form-field>` and the control projected inside it. */
export interface FormFieldHost {
  readonly controlId: string;
  readonly describedBy: Signal<string | null>;
  readonly required: Signal<boolean>;
  registerControl(control: FieldControl): void;
}

export const ALCO_FORM_FIELD = new InjectionToken<FormFieldHost>('ALCO_FORM_FIELD');
