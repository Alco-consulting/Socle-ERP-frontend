import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Page heading as the plate: the title (the page's only h1), status, subtitle and actions on
 * the logo's gradient, a rounded card. Slots: `[alcoPageStatus]`, `[alcoPageActions]`. A form's
 * heading stays in view (`sticky`) and says its changes not saved yet (`dirty`).
 */
@Component({
  selector: 'alco-page-header',
  host: { class: 'alco-plate', '[class.sticky]': 'sticky()' },
  template: `
    <div class="heading">
      <h1 class="alco-page-title">{{ title() }}</h1>
      <ng-content select="[alcoPageStatus]" />
      @if (dirty()) {
        <span class="dirty" role="status">
          <span class="dirty-dot" aria-hidden="true"></span>
          Modifications non enregistrées
        </span>
      }
      @if (subtitle()) {
        <p class="subtitle">{{ subtitle() }}</p>
      }
    </div>
    <div class="actions"><ng-content select="[alcoPageActions]" /></div>
  `,
  styles: `
    /* On the plate (global .alco-plate). */
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3) var(--space-4);
    }
    /* Kept under the menu while the form scrolls. */
    :host(.sticky) {
      position: sticky;
      top: calc(var(--topbar-height) + var(--module-nav-height) + var(--space-2));
      z-index: var(--z-sticky);
      padding-block: var(--space-4);
    }
    h1 {
      font-size: var(--font-size-plate-title);
      font-weight: var(--font-weight-heavy);
    }
    .dirty {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      border-radius: var(--radius-pill);
      background: var(--color-warning-soft);
      color: var(--color-warning-text);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-semibold);
    }
    .dirty-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--radius-pill);
      background: currentColor;
    }
    .heading {
      display: flex;
      flex: 1 1 16rem;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-3);
      min-width: 0;
    }
    .subtitle {
      flex-basis: 100%;
      margin: 0;
      color: var(--color-text-muted);
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
    @media (max-width: 767.98px) {
      :host(.sticky) {
        position: relative;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoPageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  /** A form: the heading, with its Save button, stays in view while the page scrolls. */
  readonly sticky = input(false);
  /** The form holds changes not saved yet: said next to the title. */
  readonly dirty = input(false);
}
