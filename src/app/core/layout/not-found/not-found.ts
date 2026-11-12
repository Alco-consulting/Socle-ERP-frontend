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
  styles: `
    main {
      display: flex;
      justify-content: center;
      padding: max(var(--space-7), 12vh) var(--page-gutter) var(--space-8);
    }
    main:focus {
      outline: none;
    }
    alco-empty-state {
      width: min(32rem, 100%);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: var(--shadow-md);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
