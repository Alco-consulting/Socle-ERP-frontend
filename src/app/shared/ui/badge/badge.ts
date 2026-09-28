import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

/** The generic workflow states of the application. A feature maps its own API states here. */
export type BadgeStatus =
  'draft' | 'pending' | 'validated' | 'closed' | 'blocked' | 'cancelled' | 'failed';

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

interface StatusPresentation {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

/** Single source of truth for state colors: same state, same look, everywhere. */
export const STATUS_PRESENTATION: Readonly<Record<BadgeStatus, StatusPresentation>> = {
  draft: { label: 'Brouillon', tone: 'neutral', icon: 'edit' },
  pending: { label: 'En attente', tone: 'warning', icon: 'clock' },
  validated: { label: 'Validé', tone: 'success', icon: 'check' },
  closed: { label: 'Clôturé', tone: 'primary', icon: 'lock' },
  blocked: { label: 'Bloqué', tone: 'danger', icon: 'alert-triangle' },
  cancelled: { label: 'Annulé', tone: 'neutral', icon: 'close' },
  failed: { label: 'Échoué', tone: 'danger', icon: 'alert-circle' },
};

/**
 * Status badge: text + pictogram + color, never the color alone.
 * Either give a `status` (preferred) or a free `tone` with projected text.
 */
@Component({
  selector: 'alco-badge',
  imports: [AlcoIcon],
  template: `
    @if (iconName(); as name) {
      <alco-icon [name]="name" [size]="12" />
    }
    <span>
      @if (status()) {
        {{ label() || presentation()?.label }}
      } @else {
        <ng-content />
      }
    </span>
  `,
  styleUrl: './badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"alco-badge alco-badge--" + resolvedTone()' },
})
export class AlcoBadge {
  readonly status = input<BadgeStatus | undefined>(undefined);
  /** Overrides the default label of the status (e.g. « Soumis » for `pending`). */
  readonly label = input('');
  readonly tone = input<BadgeTone>('neutral');
  readonly icon = input<IconName | undefined>(undefined);

  protected readonly presentation = computed(() => {
    const status = this.status();
    return status ? STATUS_PRESENTATION[status] : undefined;
  });
  protected readonly resolvedTone = computed(() => this.presentation()?.tone ?? this.tone());
  protected readonly iconName = computed(() => this.icon() ?? this.presentation()?.icon);
}
