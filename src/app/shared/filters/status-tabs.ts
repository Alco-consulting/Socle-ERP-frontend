import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** One tab: a state of the list's records (`null`: all of them). */
export interface StatusTab {
  readonly id: string | null;
  readonly label: string;
}

/**
 * The states of a list in one click (« Toutes · Brouillons · À valider · Validées »), on top
 * of its toolbar. The page owns the state (its URL) and applies the choice.
 */
@Component({
  selector: 'alco-status-tabs',
  template: `
    <div class="tabs" role="group" [attr.aria-label]="label()">
      @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          class="tab"
          [class.tab--active]="tab.id === value()"
          [attr.aria-pressed]="tab.id === value()"
          (click)="selected.emit(tab.id)"
        >
          {{ tab.label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    /* Square segments side by side; the chosen one filled with the navy. */
    .tabs {
      display: flex;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab {
      flex: none;
      height: var(--control-height-sm);
      padding: 0 var(--space-4);
      border: var(--border-width) solid var(--color-border-strong);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text-muted);
      font: inherit;
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
      cursor: pointer;
      transition:
        background-color var(--duration-fast) var(--easing-standard),
        color var(--duration-fast) var(--easing-standard);
    }
    .tab + .tab {
      margin-left: calc(-1 * var(--border-width));
    }
    .tab:hover {
      background: var(--color-surface-sunken);
      color: var(--color-text);
    }
    .tab--active,
    .tab--active:hover {
      border-color: var(--color-primary);
      background: var(--color-primary);
      color: var(--color-text-inverse);
      font-weight: var(--font-weight-bold);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoStatusTabs {
  readonly tabs = input.required<readonly StatusTab[]>();
  /** The current state; `null`: all. */
  readonly value = input<string | null>(null);
  /** Accessible name of the group (« États des écritures »). */
  readonly label = input.required<string>();

  readonly selected = output<string | null>();
}
