import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface WorkflowStep {
  readonly id: string;
  readonly label: string;
}

/**
 * Read-only lifecycle « Brouillon — Soumise — Validée — Verrouillée »: a track of round
 * marks, the steps behind filled, the current one in the navy with a halo. The API's state; its transitions are the page's buttons.
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
      font-weight: var(--font-weight-medium);
    }
    li + li::before {
      content: '';
      width: var(--space-5);
      height: 2px;
      margin: 0 var(--space-1) 0 var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-border);
    }
    .done + li::before,
    .done + .current::before {
      background: var(--color-primary);
    }
    .mark {
      width: 10px;
      height: 10px;
      border: 2px solid var(--color-border-strong);
      border-radius: 50%;
    }
    .done {
      color: var(--color-text);
    }
    .done .mark {
      border-color: var(--color-primary);
      background: var(--color-primary);
    }
    .current {
      color: var(--color-primary-text);
      font-weight: var(--font-weight-semibold);
    }
    .current .mark {
      width: 12px;
      height: 12px;
      border-color: var(--color-primary);
      background: var(--color-primary);
      box-shadow: 0 0 0 4px var(--color-primary-soft);
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
