import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface WorkflowStep {
  readonly id: string;
  readonly label: string;
}

/**
 * Read-only lifecycle « Brouillon — Soumise — Validée — Verrouillée »: a track of square
 * marks, the current one in amber. The API's state; its transitions are the page's buttons.
 */
@Component({
  selector: 'alco-workflow-steps',
  template: `
    <ol role="list" [attr.aria-label]="label()">
      @for (step of steps(); track step.id; let i = $index) {
        <li
          [class.done]="i < currentIndex()"
          [class.current]="i === currentIndex()"
          [attr.aria-current]="i === currentIndex() ? 'step' : null"
        >
          <span class="mark" aria-hidden="true"></span>
          {{ step.label }}
        </li>
      }
    </ol>
  `,
  styles: `
    ol {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      row-gap: var(--space-1);
    }
    li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    li + li::before {
      content: '';
      width: var(--space-5);
      height: 2px;
      margin-right: var(--space-1);
      background: var(--color-border-strong);
    }
    .mark {
      width: 10px;
      height: 10px;
      border: 2px solid currentColor;
    }
    .done .mark {
      background: currentColor;
    }
    .current {
      color: var(--color-text);
      font-weight: var(--font-weight-heavy);
    }
    .current .mark {
      width: 12px;
      height: 12px;
      border-color: var(--color-action);
      background: var(--color-action);
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
