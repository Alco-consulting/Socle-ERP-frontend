import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Page heading: title (the page's only h1), optional status and actions.
 * Actions are always on the right of the title (below it on narrow screens), the primary
 * action last. Slots: `[alcoPageStatus]`, `[alcoPageActions]`.
 */
@Component({
  selector: 'alco-page-header',
  template: `
    <div class="heading">
      <h1 class="alco-page-title">{{ title() }}</h1>
      <ng-content select="[alcoPageStatus]" />
      @if (subtitle()) {
        <p class="subtitle alco-caption">{{ subtitle() }}</p>
      }
    </div>
    <div class="actions"><ng-content select="[alcoPageActions]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      min-width: 0;
    }
    .subtitle {
      flex-basis: 100%;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .actions:empty {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoPageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}
