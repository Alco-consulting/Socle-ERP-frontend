import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AlcoPrototypeBanner } from './features/prototype/prototype-banner';
import { AlcoToastOutlet } from './shared/ui/toast/toast-outlet';

@Component({
  selector: 'alco-root',
  imports: [RouterOutlet, AlcoPrototypeBanner, AlcoToastOutlet],
  template: `
    <a class="alco-skip-link" href="#contenu" (click)="skipToContent($event)">Aller au contenu</a>
    <alco-prototype-banner />
    <router-outlet />
    <alco-toast-outlet />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  /** With `<base href="/">` a bare `#contenu` link would reload the home page. */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    document.getElementById('contenu')?.focus();
  }
}
