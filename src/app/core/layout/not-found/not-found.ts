import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoTopbar } from '../topbar/topbar';

@Component({
  selector: 'alco-not-found',
  imports: [RouterLink, AlcoButton, AlcoEmptyState, AlcoTopbar],
  template: `
    <alco-topbar />
    <main id="contenu" tabindex="-1">
      <h1 class="alco-sr-only">Page introuvable</h1>
      <alco-empty-state
        icon="search"
        title="Cette page n’existe pas."
        message="Le lien est peut-être incomplet ou l’écran a été déplacé."
      >
        <a alcoButton variant="primary" routerLink="/app">Revenir aux applications</a>
      </alco-empty-state>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
