import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { APP_CONFIG } from './core/config/app-config';
import { LoadingService } from './core/http/loading.service';
import { AlcoPrototypeBanner } from './features/prototype/prototype-banner';
import { AlcoProgressBar } from './shared/ui/progress-bar/progress-bar';
import { AlcoToastOutlet } from './shared/ui/toast/toast-outlet';

@Component({
  selector: 'alco-root',
  imports: [RouterOutlet, AlcoPrototypeBanner, AlcoProgressBar, AlcoToastOutlet],
  template: `
    <a class="alco-skip-link" href="#contenu" (click)="skipToContent($event)">Aller au contenu</a>
    <alco-progress-bar [active]="loading.busy()" />
    @if (prototype) {
      <alco-prototype-banner />
    }
    <router-outlet />
    <alco-toast-outlet />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly loading = inject(LoadingService);
  protected readonly prototype = inject(APP_CONFIG).sessionSource === 'prototype';

  /** With `<base href="/">` a bare `#contenu` link would reload the home page. */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    document.getElementById('contenu')?.focus();
  }
}
