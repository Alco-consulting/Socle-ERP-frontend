import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { DueApi } from '../data-access/due-api';
import { isoDay } from '../entries/entry-presentation';
import { DUE_ERRORS, DUE_ROLES, DUE_STATUS } from './due-presentation';

/**
 * An installment (`GET due-items/{id}/`): its due date and amounts, as the server computed
 * and settled them, and each settlement with the lettering it came from. Links: its schedule,
 * its entry, its partner, the lettering.
 */
@Component({
  selector: 'alco-due-item-detail',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './due-item-detail.html',
  styleUrls: ['../accounting-sheet.scss', './due-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DueItemDetailPage {
  private readonly api = inject(DueApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly navigation = inject(NavigationService);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.item(untracked(this.id)), {
    immediate: false,
  });
  protected readonly item = computed(() => this.record.value());
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, DUE_ERRORS) : null;
  });
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly accounting = `${APP_ROOT}/comptabilite`;
  protected readonly day = isoDay;
  protected readonly roles = DUE_ROLES;
  protected readonly canOpenPartner = computed(() =>
    this.navigation.canOpenUrl(`${APP_ROOT}/comptabilite/contacts`),
  );
  protected readonly canOpenLettering = computed(() =>
    this.navigation.canOpenUrl(`${APP_ROOT}/comptabilite/lettrage`),
  );
  protected readonly status = computed(() => {
    const item = this.item();
    return item ? DUE_STATUS[item.status] : null;
  });

  constructor() {
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      )
      .subscribe((decimals) => this.decimals.set(decimals));
    effect(() => {
      this.id();
      untracked(() => this.record.reload());
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.breadcrumbs.nameCurrent(`Échéance du ${isoDay(loaded.due_date)}`));
      }
    });
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }
}
