import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';

import { AlcoBreadcrumb } from '../../../shared/ui/breadcrumb/breadcrumb';
import { AlcoModuleNav } from '../../../shared/ui/module-nav/module-nav';
import { findApplication } from '../../navigation/applications';
import { NavigationService } from '../../navigation/navigation.service';
import { BreadcrumbService } from '../../navigation/route-trail';
import { AlcoTopbar } from '../topbar/topbar';

/**
 * Frame of every application: top bar, horizontal module navigation, breadcrumb, screen.
 * No global sidebar: switching application goes through the launcher (apps button).
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoModuleShell {
  private readonly navigation = inject(NavigationService);
  protected readonly breadcrumb = inject(BreadcrumbService).items;

  protected readonly app = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => findApplication(data['appId'] as string))),
  );
  protected readonly menu = computed(() => {
    const app = this.app();
    return app ? this.navigation.menu(app) : [];
  });
}
