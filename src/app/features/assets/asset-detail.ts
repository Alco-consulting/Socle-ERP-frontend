import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { SessionStore } from '../../core/session/session.store';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { ClosingReasonDialogService } from '../closing/reason-dialog';
import { referencePlaces } from '../currencies/reference-places';
import { ASSET_ERRORS, ASSET_STATUS, LINE_STATUS, durationText } from './assets-presentation';
import { AssetsApi } from './data-access/assets-api';
import { DepreciationLine } from './data-access/assets-models';
import { DisposeDialogService } from './dispose-dialog';

/** One asset: what it is worth now, its depreciation month by month, and its next step. */
@Component({
  selector: 'alco-asset-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoCell,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './asset-detail.html',
  styleUrl: './asset-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetDetailPage {
  private readonly api = inject(AssetsApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly confirmService = inject(AlcoConfirmService);
  private readonly reasons = inject(ClosingReasonDialogService);
  private readonly disposals = inject(DisposeDialogService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly assetId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly places = referencePlaces();
  protected readonly status = ASSET_STATUS;
  protected readonly asset = requestState(() => this.api.asset(this.assetId));
  protected readonly plans = requestState(() => this.api.schedule(this.assetId));
  /** The command running: `confirm`, `cancel` or `dispose`. */
  protected readonly busy = signal<string | null>(null);

  /** The accounting plan in force (its last version once closed by a disposal). */
  protected readonly lines = computed<readonly DepreciationLine[]>(() => {
    const accounting = (this.plans.value() ?? []).filter((plan) => plan.kind === 'accounting');
    const current = accounting.find((plan) => plan.status === 'active') ?? accounting.at(-1);
    return (current?.lines ?? []).filter((line) => line.status !== 'superseded');
  });
  protected readonly isDraft = computed(() => this.asset.value()?.status === 'draft');
  protected readonly canEdit = computed(() => this.isDraft() && this.session.can('assets.update'));
  protected readonly canConfirm = computed(
    () => this.isDraft() && this.session.can('assets.activate'),
  );
  protected readonly canDispose = computed(
    () =>
      this.asset.value()?.status === 'in_service' &&
      ['assets.dispose', 'assets.depreciate', 'assets.account'].every((code) =>
        this.session.can(code),
      ),
  );
  protected readonly loadError = computed(() => {
    const error = this.asset.error();
    return error ? toUserError(error, ASSET_ERRORS) : null;
  });

  protected readonly columns: readonly TableColumn[] = [
    { key: 'period', label: 'Mois' },
    { key: 'amount', label: 'Dotation', width: '10rem', numeric: true },
    { key: 'cumulative', label: 'Cumul', width: '10rem', numeric: true, hideBelow: 'tablet' },
    { key: 'net', label: 'Valeur nette', width: '10rem', numeric: true },
    { key: 'status', label: 'État', width: '10rem' },
  ];
  protected readonly lineId = (line: DepreciationLine) => line.public_id;

  constructor() {
    effect(() => {
      const asset = this.asset.value();
      if (asset) {
        untracked(() => this.breadcrumbs.nameCurrent(asset.name));
      }
    });
  }

  protected duration(months: number): string {
    return durationText(months);
  }

  protected lineStatus(line: DepreciationLine): string {
    return LINE_STATUS[line.status];
  }

  protected async confirm(): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Confirmer l’immobilisation ?',
      message:
        'Elle reçoit son numéro et son tableau d’amortissement ; elle ne se modifie plus ensuite.',
      confirmLabel: 'Confirmer',
    });
    if (confirmed) {
      await this.run('confirm', async () => {
        await firstValueFrom(this.api.confirm(this.assetId));
        this.toast.success('Immobilisation confirmée : son tableau d’amortissement est prêt.');
      });
    }
  }

  protected async cancel(): Promise<void> {
    const reason = await this.reasons.ask({
      title: 'Annuler cette immobilisation ?',
      message: 'Elle reste visible, annulée ; rien n’est comptabilisé.',
      confirmLabel: 'Annuler l’immobilisation',
      tone: 'danger',
    });
    if (reason) {
      await this.run('cancel', async () => {
        await firstValueFrom(this.api.cancel(this.assetId, reason));
        this.toast.success('Immobilisation annulée.');
      });
    }
  }

  protected async dispose(): Promise<void> {
    const asset = this.asset.value();
    const disposal = asset ? await this.disposals.ask(asset.name) : null;
    if (disposal) {
      // The server depreciates up to the date (the last period pro rata) then posts the disposal.
      await this.run('dispose', async () => {
        await firstValueFrom(this.api.dispose(this.assetId, disposal));
        this.toast.success('Immobilisation cédée et comptabilisée.');
      });
    }
  }

  private async run(key: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(key);
    try {
      await action();
    } catch (failure) {
      const error = toUserError(failure, ASSET_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.busy.set(null);
      this.asset.reload();
      this.plans.reload();
    }
  }
}
