import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { AlcoIcon } from '../ui/icon/icon';
import { ALCO_FORM_FIELD, FieldControl, FormFieldHost } from './form-field-token';
import { validationMessage } from './validation-messages';

/**
 * Label + control + hint + error, always in this order. The error replaces nothing: the
 * hint stays visible, the error is added below and linked with `aria-describedby`.
 * The error text comes from the control's validation state (`validation-messages.ts`),
 * or from `error` when the page provides it (server error).
 */
@Component({
  selector: 'alco-form-field',
  imports: [AlcoIcon],
  template: `
    <label class="label" [attr.for]="controlId" [id]="controlId + '-label'">
      {{ label() }}
      @if (required()) {
        <span class="required" aria-hidden="true">*</span>
      } @else if (optional()) {
        <span class="optional">(facultatif)</span>
      }
    </label>
    <ng-content />
    @if (hint()) {
      <p class="hint" [id]="controlId + '-hint'">{{ hint() }}</p>
    }
    @if (errorText(); as message) {
      <p class="error" [id]="controlId + '-error'">
        <alco-icon name="alert-circle" [size]="14" />
        {{ message }}
      </p>
    }
  `,
  styleUrl: './form-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: ALCO_FORM_FIELD, useExisting: AlcoFormField }],
})
export class AlcoFormField implements FormFieldHost {
  private static nextId = 0;

  readonly label = input.required<string>();
  readonly hint = input('');
  readonly required = input(false);
  /** Shows « (facultatif) » — used when most fields of the form are required. */
  readonly optional = input(false);
  /** Explicit error (typically returned by the server); overrides the validation message. */
  readonly error = input<string | null>(null);

  readonly controlId = `alco-field-${AlcoFormField.nextId++}`;
  private readonly control = signal<FieldControl | null>(null);

  protected readonly errorText = computed(() => {
    const explicit = this.error();
    if (explicit) {
      return explicit;
    }
    const control = this.control();
    return control?.showsError() ? validationMessage(control.state().errors) : null;
  });

  readonly describedBy = computed(() => {
    const ids = [
      this.hint() ? `${this.controlId}-hint` : null,
      this.errorText() ? `${this.controlId}-error` : null,
    ].filter((id): id is string => id !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  registerControl(control: FieldControl): void {
    this.control.set(control);
  }
}
