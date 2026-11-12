import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AlcoBreadcrumb } from '../../../shared/ui/breadcrumb/breadcrumb';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoModuleNav } from '../../../shared/ui/module-nav/module-nav';
import { findApplication } from '../../navigation/applications';
import { BackNavigation } from '../../navigation/back-navigation';
import { NavigationService } from '../../navigation/navigation.service';
import { BreadcrumbService } from '../../navigation/route-trail';
import { AlcoTopbar } from '../topbar/topbar';

/**
 * Frame of every application: top bar, horizontal module navigation, back arrow and
 * breadcrumb, the
 * navigation of the current section (Comptabilité › Trésorerie: Comptes, Opérations…),
 * then the screen. No global sidebar: switching application goes through the launcher.
 * Route: `{ path: 'comptabilite', component: AlcoModuleShell, data: { appId: 'accounting' } }`.
 */
@Component({
  selector: 'alco-module-shell',
  imports: [RouterOutlet, RouterLink, AlcoBreadcrumb, AlcoIcon, AlcoModuleNav, AlcoTopbar],
  template: `
    <div class="sticky">
      <alco-topbar [app]="app() ?? null" />
      @if (app(); as current) {
        <alco-module-nav [entries]="menu()" [label]="'Navigation ' + current.label" />
      }
    </div>
    <main id="contenu" class="alco-page alco-stack" tabindex="-1">
      @if (breadcrumb().length > 1) {
        <div class="trail">
          @if (back(); as target) {
            <a
              class="back"
              [routerLink]="backPath(target.url)"
              [queryParams]="backQuery(target.url)"
              [attr.aria-label]="'Retour à ' + target.label"
              [attr.title]="'Retour à ' + target.label"
            >
              <alco-icon name="arrow-left" [size]="18" />
            </a>
          }
          <alco-breadcrumb [items]="breadcrumb()" />
        </div>
      }
      @if (section(); as current) {
        @if (sectionMenu().length > 1) {
          <alco-module-nav
            variant="section"
            [keep]="null"
            [entries]="sectionMenu()"
            [label]="'Navigation ' + current.label"
          />
        }
      }
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }
    .sticky {
      position: sticky;
      top: 0;
      z-index: var(--z-header);
    }
    main:focus {
      outline: none;
    }
    .trail {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }
    /* The back arrow: a rounded square before the breadcrumb, one level up. */
    .back {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: var(--control-height);
      height: var(--control-height);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--shadow-xs);
      color: var(--color-primary-text);
      transition:
        border-color var(--duration-fast) var(--easing-standard),
        background-color var(--duration-fast) var(--easing-standard),
        transform var(--duration-fast) var(--easing-standard);
    }
    .back:hover {
      border-color: var(--color-accent);
      background: var(--color-primary-softer);
      transform: translateX(-2px);
    }
    /* Each screen arrives softly (nothing when the device asks for less motion). */
    main > :last-child {
      animation: alco-page-in var(--duration-base) var(--easing-standard);
    }
    @keyframes alco-page-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoModuleShell {
  private readonly navigation = inject(NavigationService);
  private readonly router = inject(Router);
  private readonly backNavigation = inject(BackNavigation);
  protected readonly breadcrumb = inject(BreadcrumbService).items;

  protected readonly app = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => findApplication(data['appId'] as string))),
  );
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** One level up the breadcrumb (the launcher from an application's first screen). */
  protected readonly back = computed(() => {
    const app = this.app();
    return this.backNavigation.target(
      this.url(),
      this.breadcrumb(),
      app,
      app ? this.navigation.homeUrl(app) : null,
    );
  });

  protected readonly menu = computed(() => {
    const app = this.app();
    return app ? this.navigation.menu(app) : [];
  });
  protected readonly section = computed(() => {
    const app = this.app();
    return app ? this.navigation.sectionOfUrl(app, this.url()) : undefined;
  });
  protected readonly sectionMenu = computed(() => {
    const app = this.app();
    const section = this.section();
    return app && section ? this.navigation.sectionMenu(app, section) : [];
  });

  protected backPath(url: string): string {
    return url.split(/[?#]/)[0];
  }

  /** The list's own query (filters, page), when going back to it as it was left. */
  protected backQuery(url: string): Record<string, string | string[]> {
    return this.router.parseUrl(url).queryParams as Record<string, string | string[]>;
  }
}
