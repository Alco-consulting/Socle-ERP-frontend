import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

/**
 * A record's link to its related objects, with their count given by the API (« 48
 * Écritures », « 3 Historique »): a link, never a computed figure. `count` is `null` while
 * loading (shown « … ») or when not known.
 */
@Component({
  selector: 'alco-smart-button',
  imports: [RouterLink, AlcoIcon],
  template: `
    <a
      class="smart"
      [routerLink]="link()"
      [queryParams]="queryParams()"
      [fragment]="fragment()"
      [attr.aria-label]="accessibleName()"
      [attr.aria-busy]="count() === null ? 'true' : null"
    >
      <alco-icon [name]="icon()" [size]="20" />
      <span class="text">
        <span class="count" aria-hidden="true">{{ count() ?? '…' }}</span>
        <span class="label" aria-hidden="true">{{ label() }}</span>
      </span>
    </a>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .smart {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--control-height);
      padding: var(--space-1) var(--space-3);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      text-decoration: none;
    }
    .smart:hover {
      background: var(--color-surface-sunken);
    }
    .smart alco-icon {
      color: var(--color-primary);
    }
    .text {
      display: flex;
      flex-direction: column;
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
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoSmartButton {
  readonly label = input.required<string>();
  readonly icon = input.required<IconName>();
  readonly count = input<number | null>(null);
  readonly link = input.required<string | readonly unknown[]>();
  readonly queryParams = input<Params | null>(null);
  readonly fragment = input<string | undefined>(undefined);

  protected readonly accessibleName = computed(() => {
    const count = this.count();
    return count === null ? `${this.label()} : chargement` : `${this.label()} : ${count}`;
  });
}
