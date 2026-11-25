import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { LoansApi } from './data-access/loans-api';
import { LoanType } from './data-access/loans-models';
import { LOAN_ERRORS } from './loans-presentation';

/** Comptabilité › Configuration › Emprunts › Types d'emprunt, with the usual ones on demand. */
@Component({
  selector: 'alco-loan-type-list',
  imports: [
    RouterLink,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './type-list.html',
  styleUrl: './loans-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanTypeListPage {
  private readonly api = inject(LoansApi);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly canManage = computed(() => this.session.can('loans.manage_types'));
  protected readonly creatingDefaults = signal(false);
  protected readonly types = requestState(() => this.api.types().pipe(map((page) => page.results)));
  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '7rem' },
    { key: 'name', label: 'Nom' },
    { key: 'principal', label: 'Capital', width: '8rem', hideBelow: 'tablet' },
    { key: 'interest', label: 'Intérêts', width: '8rem', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (row: LoanType) => row.public_id;
  protected readonly loadError = computed(() => {
    const error = this.types.error();
    return error ? toUserError(error, LOAN_ERRORS) : null;
  });

  protected async createDefaults(): Promise<void> {
    this.creatingDefaults.set(true);
    try {
      const result = await firstValueFrom(this.api.createDefaultTypes());
      const created = result.created.length;
      this.toast.success(
        created === 0
          ? 'Les types usuels existent déjà.'
          : `${created} type${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}.`,
      );
      this.types.reload();
    } catch (failure) {
      const error = toUserError(failure, LOAN_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.creatingDefaults.set(false);
    }
  }
}
