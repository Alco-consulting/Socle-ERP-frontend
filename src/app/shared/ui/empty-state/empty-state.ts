import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

/**
 * Useful empty state: what is missing, why, and the next action (projected, and only
 * rendered by the page when the user is allowed to perform it).
 */
@Component({
  selector: 'alco-empty-state',
  imports: [AlcoIcon],
  template: `
    <span class="empty-icon"><alco-icon [name]="icon()" [size]="26" /></span>
    <h2 class="alco-section-title">{{ title() }}</h2>
    @if (message()) {
      <p class="empty-message">{{ message() }}</p>
    }
    <div class="empty-actions"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-7) var(--space-4);
      text-align: center;
    }
    /* Le pictogramme : la marine sur un rond pâle, cerclé d'un halo plus pâle encore. */
    .empty-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 60px;
      height: 60px;
      margin-bottom: var(--space-3);
      border-radius: var(--radius-pill);
      background: var(--color-primary-soft);
      box-shadow: 0 0 0 8px var(--color-primary-softer);
      color: var(--color-primary-text);
    }
    .empty-message {
      max-width: 42ch;
      color: var(--color-text-muted);
    }
    .empty-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
    .empty-actions:empty {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status' },
})
export class AlcoEmptyState {
  readonly title = input.required<string>();
  readonly message = input('');
  readonly icon = input<IconName>('inbox');
}
