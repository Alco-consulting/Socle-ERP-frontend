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

let nextId = 0;

/**
 * Free words as tags (Odoo's « create » tags: positions fiscales, grilles de taxes): typed
 * then added with Entrée (or a comma, or leaving the field), removed with their ×, the
 * last one with Retour arrière on an empty field. `suggestions` are proposed while typing;
 * a word already chosen (whatever its case) is not added twice. The value is the list of
 * words, in the order they were added.
 */
@Component({
  selector: 'alco-tag-input',
  imports: [AlcoIcon],
  template: `
    <div class="tag-input" [class.disabled]="disabled()">
      @for (word of value(); track word) {
        <span class="tag">
          <span>{{ word }}</span>
          <button
            type="button"
            class="remove"
            [disabled]="disabled()"
            [attr.aria-label]="'Retirer ' + word"
            (click)="remove(word)"
          >
            <alco-icon name="close" [size]="12" />
          </button>
        </span>
      }
      <input
        class="text"
        type="text"
        autocomplete="off"
        [attr.list]="listId"
        [id]="field?.controlId ?? null"
        [attr.aria-label]="field ? null : label()"
        [attr.aria-describedby]="field?.describedBy() ?? null"
        [placeholder]="value().length === 0 ? placeholder() : ''"
        [value]="text()"
        [disabled]="disabled()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (blur)="commit()"
      />
      <datalist [id]="listId">
        @for (suggestion of offered(); track suggestion) {
          <option [value]="suggestion"></option>
        }
      </datalist>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .tag-input {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1);
      min-height: var(--control-height);
      padding: 2px var(--space-2);
      border: var(--border-width) solid var(--color-border-strong);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .tag-input:focus-within {
      border-color: var(--color-focus-ring);
    }
    .tag-input.disabled {
      background: var(--color-surface-muted);
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      max-width: 100%;
      padding: 2px var(--space-1) 2px var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-neutral-soft);
      color: var(--color-neutral-text);
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
    .remove:focus-visible {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: 1px;
    }
    .text {
      flex: 1 1 6rem;
      min-width: 6rem;
      height: calc(var(--control-height) - 6px);
      padding: 0 var(--space-1);
      border: 0;
      background: transparent;
      color: var(--color-text);
      font: inherit;
    }
    .text:focus-visible {
      outline: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AlcoTagInput), multi: true },
  ],
})
export class AlcoTagInput implements ControlValueAccessor, FieldControl {
  protected readonly field = inject(ALCO_FORM_FIELD, { optional: true });

  /** Words proposed while typing (those already chosen are left out). */
  readonly suggestions = input<readonly string[]>([]);
  readonly placeholder = input('');
  /** Accessible name when the input is not inside an `<alco-form-field>`. */
  readonly label = input('Étiquettes');

  readonly state = signal<ControlState>({ invalid: false, touched: false, errors: null });
  protected readonly listId = `alco-tag-input-${nextId++}`;
  protected readonly value = signal<readonly string[]>([]);
  protected readonly text = signal('');
  protected readonly disabled = signal(false);
  protected readonly offered = computed(() => this.suggestions().filter((word) => !this.has(word)));

  private onChange: (value: readonly string[]) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    this.field?.registerControl(this);
  }

  showsError(): boolean {
    return false;
  }

  protected onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    if (typed.includes(',')) {
      for (const word of typed.split(',')) {
        this.add(word);
      }
      this.text.set('');
      (event.target as HTMLInputElement).value = '';
      return;
    }
    this.text.set(typed);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      // Entrée adds the word, never submits the form around.
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Backspace' && this.text() === '' && this.value().length > 0) {
      this.remove(this.value()[this.value().length - 1]);
    }
  }

  /** The word being typed becomes a tag (Entrée, comma, leaving the field). */
  protected commit(): void {
    this.add(this.text());
    this.text.set('');
    this.onTouched();
  }

  protected remove(word: string): void {
    this.update(this.value().filter((item) => item !== word));
  }

  private add(raw: string): void {
    const word = raw.trim();
    if (word && !this.has(word)) {
      this.update([...this.value(), word]);
    }
  }

  private has(word: string): boolean {
    const key = word.toLocaleLowerCase('fr');
    return this.value().some((item) => item.toLocaleLowerCase('fr') === key);
  }

  private update(value: readonly string[]): void {
    this.value.set(value);
    this.onChange(value);
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
