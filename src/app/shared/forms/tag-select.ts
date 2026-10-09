import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { AlcoIcon } from '../ui/icon/icon';
import { ALCO_FORM_FIELD, ControlState, FieldControl } from './form-field-token';

/** One choice of a tag select: its value and its words. */
export interface TagOption {
  readonly id: string;
  readonly label: string;
}

/**
 * A multiple choice among a short list (Odoo's « tags »): the chosen ones as removable tags,
 * the others in a selection list to add one. The value is the list of chosen ids, in the
 * order they were added. Used inside `<alco-form-field>` like the other controls.
 */
@Component({
  selector: 'alco-tag-select',
  imports: [AlcoIcon],
  template: `
    <div class="tag-select" [class.disabled]="disabled()">
      @if (chosen().length > 0) {
        <ul class="tags" [attr.aria-label]="label()">
          @for (option of chosen(); track option.id) {
            <li class="tag">
              <span>{{ option.label }}</span>
              <button
                type="button"
                class="remove"
                [disabled]="disabled()"
                [attr.aria-label]="'Retirer ' + option.label"
                (click)="remove(option.id)"
              >
                <alco-icon name="close" [size]="12" />
              </button>
            </li>
          }
        </ul>
      }
      <select
        class="add"
        [id]="field?.controlId ?? null"
        [attr.aria-describedby]="field?.describedBy() ?? null"
        [disabled]="disabled() || available().length === 0"
        (change)="add($event)"
        (blur)="touched()"
      >
        <option value="">
          {{ available().length === 0 && options().length > 0 ? 'Tout est choisi' : placeholder() }}
        </option>
        @for (option of available(); track option.id) {
          <option [value]="option.id">{{ option.label }}</option>
        }
      </select>
    </div>
  `,
  styles: `
    .tag-select {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      max-width: 100%;
      padding: 2px var(--space-1) 2px var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-primary-soft);
      color: var(--color-primary-text);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-medium);
    }
    .tag span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .remove {
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: var(--radius-pill);
      background: none;
      color: inherit;
      cursor: pointer;
    }
    .remove:hover {
      background: var(--color-surface);
    }
    .remove:focus-visible,
    .add:focus-visible {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: 1px;
    }
    .add {
      width: 100%;
      height: var(--control-height);
      padding: 0 var(--space-3);
      border: var(--border-width) solid var(--color-border-strong);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
    }
    .add:disabled {
      background: var(--color-surface-muted);
      color: var(--color-text-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AlcoTagSelect), multi: true },
  ],
})
export class AlcoTagSelect implements ControlValueAccessor, FieldControl {
  protected readonly field = inject(ALCO_FORM_FIELD, { optional: true });

  /** Every choice, in the order shown. */
  readonly options = input.required<readonly TagOption[]>();
  readonly placeholder = input('Ajouter…');
  /** Accessible name of the chosen tags. */
  readonly label = input('Choix');

  readonly state = signal<ControlState>({ invalid: false, touched: false, errors: null });
  protected readonly value = signal<readonly string[]>([]);
  protected readonly disabled = signal(false);
  protected readonly chosen = computed(() =>
    this.value().map(
      (id) => this.options().find((option) => option.id === id) ?? { id, label: '…' },
    ),
  );
  protected readonly available = computed(() =>
    this.options().filter((option) => !this.value().includes(option.id)),
  );

  private onChange: (value: readonly string[]) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    this.field?.registerControl(this);
  }

  showsError(): boolean {
    return false;
  }

  protected add(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    select.value = '';
    if (id && !this.value().includes(id)) {
      this.update([...this.value(), id]);
    }
  }

  protected remove(id: string): void {
    this.update(this.value().filter((item) => item !== id));
  }

  protected touched(): void {
    this.onTouched();
  }

  private update(value: readonly string[]): void {
    this.value.set(value);
    this.onChange(value);
    this.onTouched();
  }

  // ---- ControlValueAccessor --------------------------------------------------------------

  writeValue(value: readonly string[] | null): void {
    this.value.set(value ?? []);
  }

  registerOnChange(fn: (value: readonly string[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
}
