import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AlcoTopbar } from '../../core/layout/topbar/topbar';
import { AlcoApplication } from '../../core/navigation/applications';
import { NavigationService } from '../../core/navigation/navigation.service';
import { SessionStore } from '../../core/session/session.store';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoIcon } from '../../shared/ui/icon/icon';

/** Applications beyond which the launcher offers a search box. */
const SEARCH_THRESHOLD = 8;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Home of the application: one tile per application the user may open in the active
 * company. Nothing else competes for attention.
 */
@Component({
  selector: 'alco-launcher',
  imports: [RouterLink, AlcoTopbar, AlcoEmptyState, AlcoIcon],
  templateUrl: './launcher.html',
  styleUrl: './launcher.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoLauncher {
  private readonly navigation = inject(NavigationService);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  protected readonly query = signal('');
  protected readonly applications = this.navigation.applications;
  protected readonly showSearch = computed(() => this.applications().length > SEARCH_THRESHOLD);

  protected readonly firstName = computed(
    () => this.session.user()?.displayName.split(/\s+/)[0] ?? '',
  );

  protected readonly results = computed(() => {
    const query = normalize(this.query().trim());
    if (!query) {
      return this.applications();
    }
    return this.applications().filter((app) =>
      [app.label, app.description, ...(app.keywords ?? [])].some((text) =>
        normalize(text).includes(query),
      ),
    );
  });

  protected homeUrl(app: AlcoApplication): string {
    return this.navigation.homeUrl(app);
  }

  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Enter opens the first matching application. */
  protected openFirst(): void {
    const first = this.results()[0];
    if (first && this.query().trim()) {
      void this.router.navigateByUrl(this.homeUrl(first));
    }
  }
}
