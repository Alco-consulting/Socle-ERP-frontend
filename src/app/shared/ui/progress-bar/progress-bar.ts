import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Thin activity line at the very top of the page while server calls are running. Never
 * blocks nor covers anything; appears only after a short delay (no flicker on fast calls).
 * Decorative for assistive technologies: each screen announces its own loading state.
 */
@Component({
  selector: 'alco-progress-bar',
  template: `
    @if (active()) {
      <div class="bar" aria-hidden="true"><span class="runner"></span></div>
    }
  `,
  styles: `
    .bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: var(--z-toast);
      height: 3px;
      overflow: hidden;
      pointer-events: none;
      animation: alco-appear var(--duration-base) var(--easing-standard) var(--delay-progress) both;
    }
    .runner {
      display: block;
      width: 40%;
      height: 100%;
      border-radius: var(--radius-pill);
      background: var(--color-brand-accent);
      animation: alco-run var(--duration-progress) var(--easing-standard) infinite;
    }
    @keyframes alco-appear {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes alco-run {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(250%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .runner {
        width: 100%;
        animation: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoProgressBar {
  readonly active = input(false);
}
