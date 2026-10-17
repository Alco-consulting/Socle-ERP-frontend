import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoSmartButton } from '../../../shared/ui/smart-button/smart-button';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AUDIT_TYPES, AlcoObjectHistory } from '../../audit/object-history';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { LetteringApi } from '../data-access/lettering-api';
import { LetteringItem } from '../data-access/lettering-models';
import { isoDay } from '../entries/entry-presentation';
import {
  LETTERING_ERRORS,
  LETTERING_KINDS,
  LETTERING_STATUS,
  SIDES,
} from './lettering-presentation';
import { UnletterDialogService } from './unletter-dialog';

/**
 * A lettering (`GET letterings/{id}/`): its account and partner, the amount lettered on each
 * line, its state and history (Audit, `accounting.lettering`). One action, when the server
 * allows it: Délettrer (`POST letterings/{id}/unletter/`, `accounting.unletter`, a reason),
 * confirmed; the lettering is then read again — cancelled, it stays with who, when and why.
 */
@Component({
  selector: 'alco-lettering-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoSmartButton,
    AlcoTable,
  ],
  templateUrl: './lettering-detail.html',
  styleUrls: ['../accounting-sheet.scss', './lettering-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LetteringDetailPage {
  private readonly api = inject(LetteringApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly unletterDialog = inject(UnletterDialogService);
  private readonly toast = inject(AlcoToastService);
  private readonly navigation = inject(NavigationService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.lettering(untracked(this.id)), {
    immediate: false,
  });
  protected readonly lettering = computed(() => this.record.value());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, LETTERING_ERRORS) : null;
  });
  /** Decimals of each currency (`currencies/`), for display only. */
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly accounting = `${APP_ROOT}/comptabilite`;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly kinds = LETTERING_KINDS;
  protected readonly day = isoDay;
  protected readonly canUnletter = computed(() => this.session.can('accounting.unletter'));
  protected readonly canOpenPartner = computed(() =>
    this.navigation.canOpenUrl(`${APP_ROOT}/comptabilite/contacts`),
  );
  protected readonly auditType = AUDIT_TYPES.lettering;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  private readonly history = viewChild(AlcoObjectHistory);
  protected readonly historyCount = computed(() => this.history()?.total() ?? null);
  protected readonly status = computed(() => {
    const lettering = this.lettering();
    return lettering ? LETTERING_STATUS[lettering.status] : null;
  });

  protected readonly itemColumns: readonly TableColumn[] = [
    { key: 'entry', label: 'Écriture' },
    { key: 'date', label: 'Date', width: '7rem' },
    { key: 'side', label: 'Sens', width: '6rem' },
    { key: 'amount', label: 'Montant lettré', numeric: true },
  ];
  protected readonly itemId = (item: LetteringItem) => item.line;

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
        untracked(() => this.breadcrumbs.nameCurrent(loaded.reference));
      }
    });
  }

  protected sideLabel(item: LetteringItem): string {
    return SIDES[item.side];
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected async unletter(): Promise<void> {
    const lettering = this.lettering();
    if (!lettering || this.busy()) {
      return;
    }
    const reason = await this.unletterDialog.ask(lettering.reference);
    if (reason === null) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await firstValueFrom(this.api.unletter(lettering.public_id, reason));
      this.toast.success('Lettrage annulé. Les lignes sont de nouveau ouvertes.');
      this.reloadAll();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.actionError.set(toUserError(error, LETTERING_ERRORS));
        if (error.code === 'accounting_lettering_cancelled') {
          this.reloadAll();
        }
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** The lettering and its history, as the server now has them. */
  private reloadAll(): void {
    this.record.reload();
    this.history()?.reload();
  }
}
