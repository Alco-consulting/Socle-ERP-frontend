import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import {
  AfterContentInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  NgControl,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { Observable, Subject, catchError, debounceTime, map, of, switchMap, tap } from 'rxjs';

import { ALCO_FORM_FIELD, ControlState, FieldControl } from './form-field-token';

/** A choice of the list: `id` is what the form keeps (a public id), `label` what it shows. */
export interface AutocompleteOption {
  readonly id: string;
  readonly label: string;
  /** Second line, muted (a name under a code). */
  readonly detail?: string;
}

/** The server's search: the component never filters a list itself. */
export type AutocompleteSearch = (term: string) => Observable<readonly AutocompleteOption[]>;

type SearchState = 'idle' | 'searching' | 'done' | 'failed';

let nextId = 0;

/**
 * A selection field over the server's list, as Odoo's (ARIA 1.2 combobox with a listbox): a
 * click or ↓ opens the list, typing searches it. The form's value is the chosen
 * `AutocompleteOption`, or `null`; typing again forgets the choice, and a text that is not a
 * choice is invalid (`format`). Keyboard: ↓/↑ move, Entrée chooses, Échap closes.
 */
@Component({
  selector: 'alco-autocomplete',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin],
  template: `
    <div class="field" cdkOverlayOrigin #origin="cdkOverlayOrigin">
      <input
        #input
        class="alco-control alco-control--select"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-haspopup="listbox"
        aria-autocomplete="list"
        [attr.id]="field?.controlId ?? null"
        [attr.aria-label]="field ? null : label()"
        [attr.aria-describedby]="field?.describedBy() ?? null"
        [attr.aria-required]="field?.required() ? 'true' : null"
        [attr.aria-invalid]="showsError() ? 'true' : null"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="activeId()"
        [placeholder]="placeholder()"
        [value]="text()"
        [disabled]="disabled()"
        (input)="onInput($event)"
        (click)="onClick()"
        (keydown)="onKeydown($event)"
        (blur)="onBlur()"
      />
    </div>
    <p class="alco-sr-only" aria-live="polite">{{ announcement() }}</p>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayMinWidth]="panelWidth()"
      (detach)="close()"
    >
      <div class="panel">
        <ul
          class="options"
          role="listbox"
          [id]="listId"
          [attr.aria-labelledby]="field ? field.controlId + '-label' : null"
          [attr.aria-label]="field ? null : label()"
        >
          @for (option of options(); track option.id; let i = $index) {
            <li
              class="option"
              role="option"
              [id]="listId + '-' + i"
              [class.option--active]="i === active()"
              [attr.aria-selected]="i === active()"
              tabindex="-1"
              (mousedown)="$event.preventDefault()"
              (click)="choose(option)"
              (keydown.enter)="choose(option)"
            >
              <span class="option-label">{{ option.label }}</span>
              @if (option.detail) {
                <span class="alco-sr-only"> — </span>
                <span class="option-detail">{{ option.detail }}</span>
              }
            </li>
          }
        </ul>
        @if (status(); as message) {
          <p class="status">{{ message }}</p>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .field {
      width: 100%;
    }
    .panel {
      max-height: 280px;
      overflow-y: auto;
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--shadow-md);
    }
    .options {
      margin: 0;
      padding: var(--space-1) 0;
      list-style: none;
    }
    .options:empty {
      display: none;
    }
    .option {
      display: flex;
      flex-direction: column;
      padding: var(--space-2) var(--space-3);
      cursor: pointer;
    }
    .option:hover,
    .option--active {
      background: var(--color-primary-soft);
    }
    .option-label {
      font-weight: var(--font-weight-medium);
    }
    .option-detail,
    .status {
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
    }
    .status {
      margin: 0;
      padding: var(--space-2) var(--space-3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AlcoAutocomplete), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => AlcoAutocomplete), multi: true },
  ],
})
export class AlcoAutocomplete
  implements ControlValueAccessor, Validator, AfterContentInit, FieldControl
{
  protected readonly field = inject(ALCO_FORM_FIELD, { optional: true });
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  /** The server's search (one call per pause in typing). */
  readonly search = input.required<AutocompleteSearch>();
  /** Accessible name when the field has no `<alco-form-field>` label, and of the list. */
  readonly label = input('Propositions');
  readonly placeholder = input('Rechercher…');
  /** Message when the server finds nothing. */
  readonly emptyText = input('Aucun résultat.');

  readonly state = signal<ControlState>({ invalid: false, touched: false, errors: null });

  protected readonly listId = `alco-autocomplete-${nextId++}`;
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  protected readonly text = signal('');
  protected readonly selected = signal<AutocompleteOption | null>(null);
  protected readonly options = signal<readonly AutocompleteOption[]>([]);
  protected readonly searchState = signal<SearchState>('idle');
  protected readonly active = signal(-1);
  protected readonly open = signal(false);
  protected readonly disabled = signal(false);
  protected readonly panelWidth = signal(0);

  protected readonly activeId = computed(() =>
    this.open() && this.active() >= 0 ? `${this.listId}-${this.active()}` : null,
  );
  protected readonly status = computed(() => {
    switch (this.searchState()) {
      case 'searching':
        return 'Recherche…';
      case 'failed':
        return 'La recherche n’a pas abouti. Réessayez.';
      case 'done':
        return this.options().length === 0 ? this.emptyText() : null;
      default:
        return null;
    }
  });
  protected readonly announcement = computed(() => {
    if (!this.open() || this.searchState() !== 'done') {
      return this.status() ?? '';
    }
    const count = this.options().length;
    return count === 0
      ? this.emptyText()
      : `${count} proposition${count > 1 ? 's' : ''}, flèches pour parcourir.`;
  });

  private readonly origin = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly terms = new Subject<string>();
  private onChange: (value: AutocompleteOption | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    this.field?.registerControl(this);
    this.terms
      .pipe(
        tap(() => this.searchState.set('searching')),
        debounceTime(250),
        switchMap((term) =>
          this.search()(term).pipe(
            map((options) => ({ options, failed: false })),
            catchError(() => of({ options: [] as readonly AutocompleteOption[], failed: true })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ options, failed }) => {
        this.options.set(options);
        this.active.set(options.length > 0 ? 0 : -1);
        this.searchState.set(failed ? 'failed' : 'done');
      });
  }

  ngAfterContentInit(): void {
    // Read lazily: NgControl depends on this value accessor, and `formControlName` binds its
    // control in its own ngOnChanges (after this component's first hooks).
    const control = this.injector.get(NgControl, null, { self: true, optional: true })?.control;
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

  // ---- ControlValueAccessor and Validator --------------------------------------------

  writeValue(value: AutocompleteOption | null): void {
    this.selected.set(value ?? null);
    this.text.set(value?.label ?? '');
  }

  registerOnChange(fn: (value: AutocompleteOption | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    if (disabled) {
      this.close();
    }
  }

  /** A text typed but not chosen is not a value. */
  validate(): ValidationErrors | null {
    return this.text().trim() !== '' && this.selected() === null
      ? { format: 'Choisissez une proposition de la liste.' }
      : null;
  }

  // ---- Interaction --------------------------------------------------------------------

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.text.set(text);
    if (this.selected()) {
      this.selected.set(null);
    }
    this.onChange(null);
    // An empty text shows the whole list again, as a selection field.
    this.openWith(text.trim());
  }

  /** A click opens the list (all of it once a choice is shown), or closes it. */
  protected onClick(): void {
    if (this.disabled()) {
      return;
    }
    if (this.open()) {
      this.close();
      return;
    }
    this.openWith(this.selected() ? '' : this.text().trim());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) {
          this.openWith(this.selected() ? '' : this.text().trim());
        } else if (count > 0) {
          this.active.set((this.active() + 1) % count);
        }
        break;
      case 'ArrowUp':
        if (this.open() && count > 0) {
          event.preventDefault();
          this.active.set((this.active() - 1 + count) % count);
        }
        break;
      case 'Enter':
        if (this.open()) {
          event.preventDefault(); // never submits the form while choosing
          const option = this.options()[this.active()];
          if (option) {
            this.choose(option);
          }
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation(); // a dialog or a panel around stays open
          this.close();
        }
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  protected onBlur(): void {
    this.close();
    this.onTouched();
  }

  protected choose(option: AutocompleteOption): void {
    this.selected.set(option);
    this.text.set(option.label);
    this.onChange(option);
    this.close();
    this.origin().nativeElement.focus();
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
    this.searchState.set('idle');
  }

  private openWith(term: string): void {
    this.panelWidth.set(this.origin().nativeElement.getBoundingClientRect().width);
    this.options.set([]);
    this.open.set(true);
    this.terms.next(term);
  }
}
