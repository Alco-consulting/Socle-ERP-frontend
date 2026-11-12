import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { AlcoIcon } from '../icon/icon';

/**
 * Frame of a modal dialog opened with the CDK `Dialog` service (focus trap, Escape,
 * focus restored on close). Modals are rare: a confirmation, a short form, an important
 * message. A complex record is a page, never a modal.
 * Slots: default body, `[alcoModalFooter]` for the buttons (primary last).
 */
@Component({
  selector: 'alco-modal',
  imports: [AlcoIcon],
  template: `
    <header class="modal-header">
      <h2 class="alco-section-title" [id]="titleId()">{{ title() }}</h2>
      <button type="button" class="close" aria-label="Fermer" (click)="closed.emit()">
        <alco-icon name="close" [size]="18" />
      </button>
    </header>
    <div class="modal-body"><ng-content /></div>
    <footer class="modal-footer"><ng-content select="[alcoModalFooter]" /></footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: min(480px, 100%);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: var(--shadow-lg);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-5) 0;
    }
    .close {
      display: inline-flex;
      padding: var(--space-1);
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
    }
    .close:hover {
      background: var(--color-surface-sunken);
    }
    .modal-body {
      padding: var(--space-3) var(--space-5) var(--space-5);
      color: var(--color-text-muted);
    }
    .modal-footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-5);
      border-top: var(--border-width) solid var(--color-border);
      background: var(--color-surface-muted);
      border-radius: 0 0 var(--radius-xl) var(--radius-xl);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoModal {
  readonly title = input.required<string>();
  /** Id of the title element, referenced by the dialog's `ariaLabelledBy`. */
  readonly titleId = input('alco-modal-title');

  readonly closed = output<void>();
}
