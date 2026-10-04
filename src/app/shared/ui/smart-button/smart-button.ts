import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

let ids = 0;

/**
 * A record's link to its related objects (« 48 Écritures », « Grand livre »): one look for
 * every record. The count is the API's, never computed:
 * - `count`: a number; `null` while it loads (« … »); left out when the relation has none
 *   to show (Grand livre);
 * - `unavailable`: a relation the API does not offer yet (Lettrage) — shown disabled with
 *   this reason (announced, and as a tooltip on hover and keyboard focus), never a link.
 * Keyboard: a link (or, disabled, a focusable button that does nothing); visible focus.
 */
@Component({
  selector: 'alco-smart-button',
  imports: [RouterLink, AlcoIcon],
  template: `
    @if (unavailable(); as reason) {
      <button
        type="button"
        class="smart smart--disabled"
        aria-disabled="true"
        [attr.aria-describedby]="reasonId"
      >
        <alco-icon [name]="icon()" [size]="20" />
        <span class="text">
          <span class="label">{{ label() }}</span>
        </span>
      </button>
      <span class="tooltip" role="tooltip" [id]="reasonId">{{ reason }}</span>
    } @else {
      <a
        class="smart"
        [routerLink]="link()"
        [queryParams]="queryParams()"
        [fragment]="fragment()"
        [attr.aria-label]="accessibleName()"
        [attr.aria-busy]="count() === null ? 'true' : null"
      >
        <alco-icon [name]="icon()" [size]="20" />
        <span class="text" aria-hidden="true">
          @if (count() !== undefined) {
            <span class="count">{{ count() ?? '…' }}</span>
          }
          <span class="label">{{ label() }}</span>
        </span>
      </a>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      max-width: 100%;
    }
    .smart {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
      min-height: var(--control-height);
      padding: var(--space-1) var(--space-3);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }
    a.smart:hover {
      background: var(--color-surface-sunken);
    }
    .smart alco-icon {
      flex: none;
      color: var(--color-primary);
    }
    .smart--disabled {
      border-style: dashed;
      background: transparent;
      color: var(--color-text-subtle);
      cursor: not-allowed;
    }
    .smart--disabled alco-icon {
      color: var(--color-text-subtle);
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      line-height: 1.2;
    }
    .count {
      font-weight: var(--font-weight-semibold);
      font-variant-numeric: tabular-nums;
      color: var(--color-primary-text);
    }
    .label {
      font-size: var(--font-size-caption);
      color: var(--color-text-muted);
      overflow-wrap: anywhere;
    }
    /* Under the button, as wide as it (never past the screen); shown on hover and focus. */
    .tooltip {
      position: absolute;
      top: calc(100% + var(--space-1));
      right: 0;
      left: 0;
      z-index: var(--z-dropdown);
      display: none;
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--color-text);
      color: var(--color-surface);
      font-size: var(--font-size-caption);
      pointer-events: none;
    }
    .smart--disabled:hover + .tooltip,
    .smart--disabled:focus-visible + .tooltip {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoSmartButton {
  readonly label = input.required<string>();
  readonly icon = input.required<IconName>();
  /** The API's count; `null`: loading; `undefined`: no count for this relation. */
  readonly count = input<number | null | undefined>(undefined);
  readonly link = input<string | readonly unknown[]>('.');
  readonly queryParams = input<Params | null>(null);
  readonly fragment = input<string | undefined>(undefined);
  /** Reason the relation is not available yet: disabled, never a link. */
  readonly unavailable = input<string | undefined>(undefined);

  protected readonly reasonId = `alco-smart-reason-${++ids}`;

  protected readonly accessibleName = computed(() => {
    const count = this.count();
    if (count === undefined) {
      return this.label();
    }
    return count === null ? `${this.label()} : chargement` : `${this.label()} : ${count}`;
  });
}
