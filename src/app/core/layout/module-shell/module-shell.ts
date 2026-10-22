import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AlcoBreadcrumb } from '../../../shared/ui/breadcrumb/breadcrumb';
import { AlcoModuleNav } from '../../../shared/ui/module-nav/module-nav';
import { findApplication } from '../../navigation/applications';
import { NavigationService } from '../../navigation/navigation.service';
import { BreadcrumbService } from '../../navigation/route-trail';
import { AlcoTopbar } from '../topbar/topbar';

/**
 * Frame of every application: top bar, horizontal module navigation, breadcrumb, the
 * navigation of the current section (Comptabilité › Trésorerie: Comptes, Opérations…),
 * then the screen. No global sidebar: switching application goes through the launcher.
 * Route: `{ path: 'comptabilite', component: AlcoModuleShell, data: { appId: 'accounting' } }`.
 */
@Component({
  selector: 'alco-module-shell',
  imports: [RouterOutlet, AlcoBreadcrumb, AlcoModuleNav, AlcoTopbar],
  template: `
    <div class="sticky">
      <alco-topbar [app]="app() ?? null" />
      @if (app(); as current) {
        <alco-module-nav [entries]="menu()" [label]="'Navigation ' + current.label" />
      }
    </div>
    <main id="contenu" class="alco-page alco-stack" tabindex="-1">
      @if (breadcrumb().length > 1) {
        <alco-breadcrumb [items]="breadcrumb()" />
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
}
