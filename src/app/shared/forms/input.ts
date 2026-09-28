import {
  AfterContentInit,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgControl, ValidationErrors } from '@angular/forms';

import { ALCO_FORM_FIELD } from './form-field-token';

export interface ControlState {
  readonly invalid: boolean;
  readonly touched: boolean;
  readonly errors: ValidationErrors | null;
}

/**
 * Styles a native control and wires it to its `<alco-form-field>`: id, label,
 * `aria-describedby` (hint + error), `aria-invalid`.
 * One directive for every native control: `input[alcoInput]`, `textarea[alcoInput]`,
 * `select[alcoSelect]` (AlcoSelect) and `input[type=date][alcoDatePicker]` (AlcoDatePicker).
 */
@Directive({
  selector: 'input[alcoInput], textarea[alcoInput], select[alcoSelect], input[alcoDatePicker]',
  host: {
    class: 'alco-control',
    '[class.alco-control--select]': 'isSelect',
    '[class.alco-num]': 'numeric()',
    '[attr.id]': 'field?.controlId ?? null',
    '[attr.aria-describedby]': 'field?.describedBy() ?? null',
    '[attr.aria-invalid]': 'showsError() ? "true" : null',
    '[attr.aria-required]': 'field?.required() ? "true" : null',
  },
})
export class AlcoInput implements AfterContentInit {
  protected readonly field = inject(ALCO_FORM_FIELD, { optional: true });
  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly destroyRef = inject(DestroyRef);
  protected readonly isSelect =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.tagName === 'SELECT';

  /** Right-aligned tabular figures (amounts). */
  readonly numeric = input(false);

  readonly state = signal<ControlState>({ invalid: false, touched: false, errors: null });

  constructor() {
    this.field?.registerControl(this);
  }

  ngAfterContentInit(): void {
    // The reactive-forms directive binds its control in ngOnChanges: read it afterwards.
    const control = this.ngControl?.control;
    if (!control) {
      return;
    }
    const sync = () =>
      this.state.set({
        invalid: control.invalid,
        touched: control.touched,
        errors: control.errors,
      });
    sync();
    const subscription = control.events.subscribe(sync);
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  showsError(): boolean {
    const state = this.state();
    return state.invalid && state.touched;
  }
}
