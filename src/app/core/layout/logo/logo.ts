import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Alco's mark (public/svg/logo-alco.svg, as provided) and its name. */
@Component({
  selector: 'alco-logo',
  template: `
    <img class="mark" src="svg/logo-alco.svg" width="28" height="28" alt="" />
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
    .mark {
      flex: none;
      width: 28px;
      height: 28px;
    }
    .wordmark {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-1);
      line-height: 1;
    }
    .name {
      font-size: var(--font-size-lead);
      font-weight: var(--font-weight-semibold);
      letter-spacing: -0.01em;
    }
    .suffix {
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-medium);
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
