import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { listPaging } from '../../../shared/ui/pagination/page-size';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AppUser, SettingsApi } from '../data-access/settings-api';
import { SETTINGS_ERRORS, initials, personName } from '../settings-presentation';

/**
 * Paramètres › Utilisateurs (`GET users/`, the global `users.read`): the accounts of the
 * platform, read only — an account is created and closed by the platform administrator.
 */
@Component({
  selector: 'alco-user-list',
  imports: [
    AlcoBadge,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './user-list.html',
  styleUrls: ['../../accounting/accounting-list.scss', '../settings-people.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListPage {
  private readonly api = inject(SettingsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly name = personName;
  protected readonly initials = initials;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'person', label: 'Utilisateur' },
    { key: 'email', label: 'E-mail', hideBelow: 'tablet' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: AppUser) => row.public_id;
  protected readonly rowLabel = (row: AppUser) => personName(row);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get('page')) || 1));
  /** 20 par page par défaut ; 40, 50 ou 100 au choix, dans l'adresse et retenu. */
  protected readonly paging = listPaging(this.params);
  protected readonly list = requestState(
    () => this.api.users(untracked(this.page), untracked(this.paging.size)),
    {
      immediate: false,
    },
  );
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, SETTINGS_ERRORS) : null;
  });

  constructor() {
    effect(() => {
      this.page();
      this.paging.size();
      untracked(() => this.list.reload());
    });
  }

  protected setPage(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
    });
  }

  protected setPageSize(size: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paging.choose(size, 'page'),
      queryParamsHandling: 'merge',
    });
  }
}
