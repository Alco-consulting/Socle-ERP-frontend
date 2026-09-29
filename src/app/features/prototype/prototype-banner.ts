import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

import { AlcoIcon } from '../../shared/ui/icon/icon';

/** Whether a screen of the route chain is a demonstration (`data: { demo: true }`). */
function isDemo(route: ActivatedRouteSnapshot | null): boolean {
  for (let current = route; current; current = current.firstChild) {
    if (current.data['demo'] === true) {
      return true;
    }
  }
  return false;
}

/**
 * PROTOTYPE — the user, the company and the permissions are real (API); the screens of the
 * prototype (accounting dashboard, entries, partners, contextual imports) still show
 * fictitious data. This strip says so on each of them, and only there. Removed with them.
 */
@Component({
  selector: 'alco-prototype-banner',
  imports: [AlcoIcon],
  template: `
    @if (visible()) {
      <div class="banner" role="note" aria-label="Démonstration">
        <alco-icon name="info" [size]="16" />
        <p>
          <strong>Écran de démonstration</strong>
          <span class="detail"
            >&nbsp;— données fictives, sans lien avec la société active ; cet écran n’est pas encore
            relié à l’API.</span
          >
        </p>
      </div>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--prototype-banner-height);
      padding: var(--space-1) var(--page-gutter);
      background: var(--color-warning-soft);
      color: var(--color-warning-text);
      font-size: var(--font-size-caption);
    }
    p {
      flex: 1;
      min-width: 0;
    }
    @media (max-width: 767.98px) {
      .detail {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoPrototypeBanner {
  private readonly router = inject(Router);

  protected readonly visible = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => isDemo(this.router.routerState.snapshot.root)),
    ),
    { initialValue: isDemo(this.router.routerState.snapshot.root) },
  );
}
