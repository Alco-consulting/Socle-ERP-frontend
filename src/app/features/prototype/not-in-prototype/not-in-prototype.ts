import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';

/**
 * PROTOTYPE — screens that exist in the navigation but not yet in the prototype. The page
 * says so plainly instead of showing an empty or fake screen.
 */
@Component({
  selector: 'alco-not-in-prototype',
  imports: [RouterLink, AlcoButton, AlcoEmptyState, AlcoPageHeader],
  template: `
    <alco-page-header [title]="title()" />
    <alco-empty-state
      icon="dashboard"
      title="Écran prévu, pas encore construit."
      message="Ce prototype montre la navigation et le design system. Cet écran sera réalisé avec son module métier, branché sur l’API."
    >
      <a alcoButton [routerLink]="homeUrl()">Retour à {{ appLabel() }}</a>
      <a alcoButton variant="ghost" routerLink="/">Toutes les applications</a>
    </alco-empty-state>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotInPrototypePage {
  private readonly trail = inject(BreadcrumbService).items;

  protected readonly title = computed(() => this.trail().at(-1)?.label ?? 'Écran');
  protected readonly appLabel = computed(() => this.trail()[0]?.label ?? 'l’application');
  protected readonly homeUrl = computed(() => this.trail()[0]?.url ?? '/');
}
