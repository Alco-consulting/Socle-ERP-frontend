import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { SessionStore } from '../../session/session.store';
import { AlcoLogo } from '../logo/logo';

/**
 * The authenticated area (`/app`), scoped to the active company. While the company changes
 * (`CompanyContextService`), every screen of the previous one is removed — nothing of it
 * stays visible, its pending requests are cancelled —; then the screens are created again:
 * each one reloads its data with the new `X-Company-ID`, and the focus goes to the content.
 */
@Component({
  selector: 'alco-company-scope',
  imports: [RouterOutlet, AlcoLoading, AlcoLogo],
  template: `
    @if (switching()) {
      <!-- Same frame as the top bar, so that the page does not seem to empty itself. -->
      <div class="bar"><alco-logo /></div>
      <main id="contenu" class="alco-page alco-stack switching" tabindex="-1">
        <p class="alco-section-title" aria-hidden="true">Changement de société…</p>
        <alco-loading variant="cards" [rows]="3" label="Changement de société en cours…" />
      </main>
    } @else {
      <router-outlet />
    }
  `,
  styles: `
    .bar {
      display: flex;
      align-items: center;
      height: var(--topbar-height);
      padding: 0 var(--page-gutter);
      border-bottom: var(--border-width) solid var(--color-border);
      background: var(--color-topbar);
      color: var(--color-text);
    }
    .switching {
      padding-top: var(--space-6);
    }
    .switching:focus {
      outline: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoCompanyScope {
  private readonly store = inject(SessionStore);
  protected readonly switching = computed(() => this.store.activity() === 'switching-company');

  constructor() {
    const injector = inject(Injector);
    let wasSwitching = false;
    effect(() => {
      const switching = this.switching();
      if (wasSwitching && !switching) {
        afterNextRender(() => document.getElementById('contenu')?.focus(), { injector });
      }
      wasSwitching = switching;
    });
  }
}
