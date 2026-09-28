import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import { AlcoButton } from '../button/button';
import { AlcoIcon } from '../icon/icon';

/**
 * Human error message: what happened, what to do, optional explanation and retry.
 * Technical details (error code, correlation id) stay folded, for support and admins.
 * `inline` renders a compact banner (inside a form) instead of a full block.
 */
@Component({
  selector: 'alco-error-state',
  imports: [AlcoButton, AlcoIcon],
  templateUrl: './error-state.html',
  styleUrl: './error-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'alert',
    '[class.error-state--inline]': 'inline()',
  },
})
export class AlcoErrorState {
  readonly title = input.required<string>();
  readonly message = input('');
  /** Longer explanation shown on demand (« Comprendre l'erreur »). */
  readonly help = input('');
  readonly code = input('');
  readonly correlationId = input('');
  readonly inline = input(false);
  readonly retryLabel = input('');

  readonly retry = output<void>();

  protected readonly helpOpen = signal(false);
}
