import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { LOGIN_REASON, LOGIN_RETURN } from '../../core/auth/session.service';
import { AlcoLogo } from '../../core/layout/logo/logo';
import { APP_ROOT } from '../../core/navigation/applications';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../shared/ui/icon/icon';

/**
 * `/login` — placeholder until the Authentication module: explains why the user is here
 * (session expired, server unreachable). The form, `auth/login/` and the return to the
 * requested page come with that module (`AuthApi.login`, `SessionService.restart`).
 */
@Component({
  selector: 'alco-login',
  imports: [AlcoEmptyState, AlcoErrorState, AlcoIcon, AlcoLogo],
  template: `
    <main id="contenu" class="page" tabindex="-1">
      <div class="panel">
        <alco-logo class="logo" />
        <h1 class="alco-page-title">Connexion</h1>

        @switch (reason()) {
          @case ('session-expiree') {
            <p class="notice" role="status">
              <alco-icon name="clock" [size]="18" />
              Votre session a expiré. Reconnectez-vous pour reprendre là où vous en étiez.
            </p>
          }
          @case ('indisponible') {
            <alco-error-state
              [inline]="true"
              title="Le serveur ne répond pas."
              message="Vérifiez votre connexion internet, puis réessayez."
              retryLabel="Réessayer"
              (retry)="retry()"
            />
          }
        }

        <alco-empty-state
          icon="lock"
          title="L’écran de connexion arrive avec le module Authentification."
          message="La session sécurisée (cookie de session, protection CSRF) et le contexte société sont déjà en place."
        />
      </div>
    </main>
  `,
  styles: `
    .page {
      display: flex;
      justify-content: center;
      min-height: 100vh;
      padding: var(--space-8) var(--space-4);
      background: var(--color-bg);
    }
    .page:focus {
      outline: none;
    }
    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      width: min(480px, 100%);
      height: fit-content;
      padding: var(--space-6) var(--space-5);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-md);
    }
    .logo {
      color: var(--color-text);
    }
    .notice {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-warning-soft);
      color: var(--color-warning-text);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => p)), {
    requireSync: true,
  });

  protected readonly reason = computed(() => this.params().get(LOGIN_REASON));
  private readonly returnUrl = computed(() => {
    const target = this.params().get(LOGIN_RETURN) ?? '';
    // Only a page of the application, never another site.
    return target.startsWith(`${APP_ROOT}/`) || target === APP_ROOT ? target : APP_ROOT;
  });

  protected retry(): void {
    void this.router.navigateByUrl(this.returnUrl());
  }
}
