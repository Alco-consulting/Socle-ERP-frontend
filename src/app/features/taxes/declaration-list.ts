import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { localToday } from '../../shared/utils/dates';
import { referencePlaces } from '../currencies/reference-places';
import { DECLARATION_PAGE_SIZE, TaxesApi } from './data-access/taxes-api';
import { Declaration } from './data-access/taxes-models';
import { DeclarationDialogService } from './declaration-dialog';
import {
  DECLARATION_ERRORS,
  DECLARATION_STATUS,
  monthBounds,
  periodLabel,
  previousMonth,
} from './declarations-presentation';

/** Comptabilité › Taxes › Déclarations: the VAT of each month, the newest first. */
@Component({
  selector: 'alco-declaration-list',
  imports: [
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './declaration-list.html',
  styleUrl: './declaration-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeclarationListPage {
  private readonly api = inject(TaxesApi);
  private readonly router = inject(Router);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);
  private readonly dialog = inject(DeclarationDialogService);

  protected readonly pageSize = DECLARATION_PAGE_SIZE;
  protected readonly period = periodLabel;
  protected readonly canCreate = computed(() => this.session.can('taxes.manage_declarations'));
  protected readonly page = signal(1);
  protected readonly creating = signal(false);
  protected readonly declarations = requestState(() => this.api.declarations(this.page()));
  protected readonly places = referencePlaces();

  protected readonly columns: readonly TableColumn[] = [
    { key: 'period', label: 'Période' },
    { key: 'calculated', label: 'TVA à payer', width: '11rem', numeric: true },
    { key: 'declared', label: 'Déclarée', width: '11rem', numeric: true, hideBelow: 'tablet' },
    { key: 'status', label: 'Étape', width: '9rem' },
  ];
  protected readonly rowId = (row: Declaration) => row.public_id;

  protected readonly loadError = computed(() => {
    const error = this.declarations.error();
    return error ? toUserError(error, DECLARATION_ERRORS) : null;
  });

  protected statusLook(row: Declaration) {
    return DECLARATION_STATUS[row.status];
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.declarations.reload();
  }

  protected async create(): Promise<void> {
    const month = await this.dialog.ask(previousMonth(localToday()));
    if (!month) {
      return;
    }
    const [start, end] = monthBounds(month);
    this.creating.set(true);
    try {
      const created = await firstValueFrom(this.api.createDeclaration(start, end));
      await this.router.navigate(['/app/comptabilite/taxes/declarations', created.public_id]);
    } catch (failure) {
      const error = toUserError(failure, DECLARATION_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.creating.set(false);
    }
  }
}
