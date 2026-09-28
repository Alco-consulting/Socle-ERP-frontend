import { InjectionToken, Signal } from '@angular/core';

import type { AlcoInput } from './input';

/** Contract between `<alco-form-field>` and the control projected inside it. */
export interface FormFieldHost {
  readonly controlId: string;
  readonly describedBy: Signal<string | null>;
  readonly required: Signal<boolean>;
  registerControl(control: AlcoInput): void;
}

export const ALCO_FORM_FIELD = new InjectionToken<FormFieldHost>('ALCO_FORM_FIELD');
