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
import { ControlValueAccessor, NG_VALUE_ACCESSOR, NgControl } from '@angular/forms';
import { Observable, Subject, catchError, debounceTime, firstValueFrom, of, switchMap } from 'rxjs';

import { ALCO_FORM_FIELD, ControlState, FieldControl } from './form-field-token';

/** A tag: its id (what the form keeps) and its name. */
export interface TagOption {
  readonly id: string;
  readonly label: string;
}

/** A choice of the list: an existing tag, or « Créer « … » ». */
interface Choice {
  readonly key: string;
  readonly label: string;
  readonly tag: TagOption | null;
}

let nextId = 0;

/**
 * Odoo's « Étiquettes » (note backend 0045): the tags chosen, removable, and a search of the
 * server's; a name it lacks is offered as « Créer « … » ». ARIA 1.2 combobox with a listbox.
 * Keyboard: ↓/↑ move, Entrée chooses or creates, Échap closes, ⌫ on an empty search removes
 * the last tag.
 */
@Component({
  selector: 'alco-tags-field',
  template: `
    <div class="tags alco-control">
      @for (tag of value(); track tag.id) {
        <span class="chip">
          {{ tag.label }}
          @if (!disabled()) {
            <button
              type="button"
              class="chip-remove"
              [attr.aria-label]="'Retirer l’étiquette ' + tag.label"
              (click)="remove(tag); $event.stopPropagation()"
            >
              ×
            </button>
          }
        </span>
      }
      <input
        #input
        class="search"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        [attr.id]="field?.controlId ?? null"
        [attr.aria-label]="field ? null : label()"
        [attr.aria-describedby]="field?.describedBy() ?? null"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="activeId()"
        [placeholder]="value().length ? '' : placeholder()"
        [value]="text()"
        [disabled]="disabled()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (focus)="openWith(text())"
        (blur)="onBlur()"
      />
    </div>
    @if (open() && choices().length > 0) {
      <ul class="list" role="listbox" [id]="listId" [attr.aria-label]="label()">
        @for (choice of choices(); track choice.key; let i = $index) {
          <li
            role="option"
            [id]="listId + '-' + i"
            [class.option--active]="i === active()"
            [class.option--create]="choice.tag === null"
            [attr.aria-selected]="i === active()"
            tabindex="-1"
            (mousedown)="$event.preventDefault()"
            (click)="pick(i)"
            (keydown.enter)="pick(i)"
          >
            {{ choice.label }}
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1);
      height: auto;
      min-height: var(--control-height);
      padding-block: var(--space-1);
    }
    /* The search input has no ring of its own: the whole field shows the focus. */
    .tags:focus-within {
      border-color: var(--color-focus-ring);
      outline: var(--focus-ring-width) solid var(--color-focus-ring);
      outline-offset: 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: 0 var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-primary-soft);
      color: var(--color-primary-text);
      font-size: var(--font-size-caption);
      line-height: 1.6;
    }
    .chip-remove {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .search {
      flex: 1 1 8rem;
      min-width: 6rem;
      border: 0;
      outline: 0;
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .list {
      position: absolute;
      z-index: var(--z-dropdown);
      top: calc(100% + var(--space-1));
      left: 0;
      right: 0;
      max-height: 15rem;
      margin: 0;
      padding: var(--space-1) 0;
      overflow-y: auto;
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--shadow-md);
      list-style: none;
    }
    li {
      padding: var(--space-2) var(--space-3);
      cursor: pointer;
    }
    .option--active {
      background: var(--color-surface-sunken);
    }
    .option--create {
      color: var(--color-primary-text);
      font-style: italic;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AlcoTagsField), multi: true },
  ],
})
export class AlcoTagsField implements ControlValueAccessor, AfterContentInit, FieldControl {
  protected readonly field = inject(ALCO_FORM_FIELD, { optional: true });
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  /** The server's tags matching a text. */
  readonly search = input.required<(term: string) => Observable<readonly TagOption[]>>();
  /** A tag of this name, created by the server; `null`: no creation offered. */
  readonly create = input<((name: string) => Observable<TagOption>) | null>(null);
  readonly label = input('Étiquettes');
  readonly placeholder = input('Ajouter une étiquette…');

  readonly state = signal<ControlState>({ invalid: false, touched: false, errors: null });

  protected readonly listId = `alco-tags-${nextId++}`;
  protected readonly value = signal<readonly TagOption[]>([]);
  protected readonly text = signal('');
  protected readonly found = signal<readonly TagOption[]>([]);
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly disabled = signal(false);

  /** The tags found and not chosen yet, then « Créer « … » » for a new name. */
  protected readonly choices = computed<readonly Choice[]>(() => {
    const chosen = new Set(this.value().map((tag) => tag.id));
    const name = this.text().trim();
    const lower = name.toLowerCase();
    const existing = [...this.value(), ...this.found()].some(
      (tag) => tag.label.toLowerCase() === lower,
    );
    return [
      ...this.found()
        .filter((tag) => !chosen.has(tag.id))
        .map((tag) => ({ key: tag.id, label: tag.label, tag })),
      ...(name && !existing && this.create()
        ? [{ key: `new:${lower}`, label: `Créer « ${name} »`, tag: null }]
        : []),
    ];
  });
  protected readonly activeId = computed(() =>
    this.open() && this.choices().length > 0 ? `${this.listId}-${this.active()}` : null,
  );

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly terms = new Subject<string>();
  private onChange: (value: readonly TagOption[]) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    this.field?.registerControl(this);
    this.terms
      .pipe(
        debounceTime(200),
        switchMap((term) =>
          this.search()(term).pipe(catchError(() => of([] as readonly TagOption[]))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((found) => {
        this.found.set(found);
        this.active.set(0);
      });
  }

  ngAfterContentInit(): void {
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

  writeValue(value: readonly TagOption[] | null): void {
    this.value.set(value ?? []);
  }

  registerOnChange(fn: (value: readonly TagOption[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    if (disabled) {
      this.open.set(false);
    }
  }

  protected onInput(event: Event): void {
    this.openWith((event.target as HTMLInputElement).value);
  }

  protected openWith(text: string): void {
    this.text.set(text);
    this.open.set(true);
    this.terms.next(text.trim());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.choices().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count > 0) {
          this.active.set((this.active() + 1) % count);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count > 0) {
          this.active.set((this.active() - 1 + count) % count);
        }
        break;
      case 'Enter':
        if (this.open() && count > 0) {
          event.preventDefault(); // never submits the form while choosing
          void this.pick(this.active());
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.open.set(false);
        }
        break;
      case 'Backspace':
        if (!this.text() && this.value().length > 0) {
          this.remove(this.value()[this.value().length - 1]);
        }
        break;
    }
  }

  protected onBlur(): void {
    this.open.set(false);
    this.onTouched();
  }

  protected async pick(index: number): Promise<void> {
    const choice = this.choices()[index];
    const create = this.create();
    if (!choice) {
      return;
    }
    const tag = choice.tag ?? (create ? await firstValueFrom(create(this.text().trim())) : null);
    if (!tag) {
      return;
    }
    if (!this.value().some((item) => item.id === tag.id)) {
      this.setValue([...this.value(), tag]);
    }
    this.text.set('');
    this.found.set([]);
    this.terms.next('');
    this.input().nativeElement.focus();
  }

  protected remove(tag: TagOption): void {
    this.setValue(this.value().filter((item) => item.id !== tag.id));
  }

  private setValue(value: readonly TagOption[]): void {
    this.value.set(value);
    this.onChange(value);
    this.onTouched();
  }
}
