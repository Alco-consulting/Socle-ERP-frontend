import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { AlcoIcon } from '../icon/icon';

export interface WorkflowStep {
  readonly id: string;
  readonly label: string;
}

/**
 * Read-only workflow indicator « Brouillon › Soumise › Validée › Verrouillée ».
 * It shows the state returned by the API; it never offers the transitions (the page shows
 * the action buttons the API allows).
 */
@Component({
  selector: 'alco-workflow-steps',
  imports: [AlcoIcon],
  template: `
    <ol role="list" [attr.aria-label]="label()">
      @for (step of steps(); track step.id; let i = $index) {
        <li
          [class.done]="i < currentIndex()"
          [class.current]="i === currentIndex()"
          [attr.aria-current]="i === currentIndex() ? 'step' : null"
        >
          @if (i < currentIndex()) {
            <alco-icon name="check" [size]="14" />
          }
          {{ step.label }}
        </li>
      }
    </ol>
  `,
  styles: `
    ol {
      display: flex;
      flex-wrap: wrap;
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      overflow: hidden;
    }
    li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-3);
      color: var(--color-text-subtle);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-medium);
    }
    li + li {
      border-left: var(--border-width) solid var(--color-border);
    }
    .done {
      color: var(--color-text-muted);
    }
    .current {
      background: var(--color-primary);
      color: var(--color-text-inverse);
      font-weight: var(--font-weight-semibold);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoWorkflowSteps {
  readonly steps = input.required<readonly WorkflowStep[]>();
  readonly current = input.required<string>();
  readonly label = input('Étapes');

  protected readonly currentIndex = computed(() =>
    this.steps().findIndex((step) => step.id === this.current()),
  );
}
