import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Alco mark + wordmark. `tone="dark"` on light backgrounds (launcher header). */
@Component({
  selector: 'alco-logo',
  template: `
    <svg class="mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect class="mark-bg" width="32" height="32" rx="8" />
      <path class="mark-a" d="M9.5 23.5 16 9l6.5 14.5" />
      <path class="mark-bar" d="M12.2 18.5h7.6" />
    </svg>
    <span class="wordmark">
      <span class="name">Alco</span>
      <span class="suffix">Consulting</span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: inherit;
    }
    .mark-bg {
      fill: var(--color-primary);
    }
    .mark-a,
    .mark-bar {
      fill: none;
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .mark-a {
      stroke: var(--color-text-inverse);
    }
    .mark-bar {
      stroke: var(--color-brand-accent);
    }
    .wordmark {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-1);
      line-height: 1;
    }
    .name {
      font-size: 1.125rem;
      font-weight: var(--font-weight-semibold);
      letter-spacing: -0.01em;
    }
    .suffix {
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-medium);
      opacity: 0.75;
    }
    :host(.compact) .suffix {
      display: none;
    }
    @media (max-width: 767.98px) {
      .suffix {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()' },
})
export class AlcoLogo {
  /** Hides « Consulting » (narrow screens). */
  readonly compact = input(false);
}
