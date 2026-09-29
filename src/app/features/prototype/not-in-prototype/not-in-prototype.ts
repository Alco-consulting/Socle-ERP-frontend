import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoTransferActions } from '../transfers/transfer-actions';
import { TransferKindId } from '../transfers/transfer-kinds';

/**
 * PROTOTYPE — screens that exist in the navigation but not yet in the prototype. The page
 * says so plainly instead of showing an empty or fake screen. When the domain has a
 * contextual import/export (route data `transfers`), its « Actions ▾ » is already in place.
 */
@Component({
  selector: 'alco-not-in-prototype',
  imports: [RouterLink, AlcoButton, AlcoEmptyState, AlcoPageHeader, AlcoTransferActions],
  template: `
    <alco-page-header [title]="title()">
      @if (transfers(); as kind) {
        <div alcoPageActions><alco-transfer-actions [kind]="kind" /></div>
      }
    </alco-page-header>
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

  protected readonly transfers = toSignal(
    inject(ActivatedRoute).data.pipe(
      map((data) => data['transfers'] as TransferKindId | undefined),
    ),
  );
  protected readonly title = computed(() => this.trail().at(-1)?.label ?? 'Écran');
  protected readonly appLabel = computed(() => this.trail()[0]?.label ?? 'l’application');
  protected readonly homeUrl = computed(() => this.trail()[0]?.url ?? '/');
}
