import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { AlcoIcon } from '../icon/icon';
import { IconName } from '../icon/icons';

/**
 * Surface grouping one functional block (dashboard workspace, form section).
 * Slots: default content, `[alcoCardActions]` in the header, `[alcoCardFooter]` at the bottom.
 */
@Component({
  selector: 'alco-card',
  imports: [AlcoIcon],
  template: `
    @if (title()) {
      <header class="card-header">
        <div class="card-heading">
          @if (icon(); as name) {
            <span class="card-icon"><alco-icon [name]="name" [size]="18" /></span>
          }
          <div>
            <h2 class="alco-section-title" [id]="titleId">{{ title() }}</h2>
            @if (subtitle()) {
              <p class="alco-caption">{{ subtitle() }}</p>
            }
          </div>
        </div>
        <ng-content select="[alcoCardActions]" />
      </header>
    }
    <div class="card-body" [class.card-body--flush]="flush()">
      <ng-content />
    </div>
    <ng-content select="[alcoCardFooter]" />
  `,
  styleUrl: './card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'region',
    '[attr.aria-labelledby]': 'title() ? titleId : null',
  },
})
export class AlcoCard {
  private static nextId = 0;

  readonly title = input('');
  readonly subtitle = input('');
  readonly icon = input<IconName | undefined>(undefined);
  /** Removes the body padding (tables, lists that run edge to edge). */
  readonly flush = input(false);

  protected readonly titleId = `alco-card-${AlcoCard.nextId++}`;
}
