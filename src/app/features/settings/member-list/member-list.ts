import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { Membership, SETTINGS_PAGE_SIZE, SettingsApi } from '../data-access/settings-api';
import { SETTINGS_ERRORS, initials, personName } from '../settings-presentation';

/**
 * Paramètres › Rôles et droits (`GET memberships/`, `companies.manage_members`): the members
 * of the active company, their roles and the number of rights granted to them; a member
 * opens on their rights.
 */
@Component({
  selector: 'alco-member-list',
  imports: [
    RouterLink,
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
  templateUrl: './member-list.html',
  styleUrls: ['../../accounting/accounting-list.scss', '../settings-people.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberListPage {
  private readonly api = inject(SettingsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);

  protected readonly pageSize = SETTINGS_PAGE_SIZE;
  protected readonly name = personName;
  protected readonly initials = initials;
  protected readonly company = computed(() => this.session.activeCompany()?.name ?? '');
  protected readonly columns: readonly TableColumn[] = [
    { key: 'person', label: 'Membre' },
    { key: 'email', label: 'E-mail', hideBelow: 'laptop' },
    { key: 'roles', label: 'Rôles', hideBelow: 'tablet' },
    { key: 'rights', label: 'Droits', width: '6rem', numeric: true, hideBelow: 'tablet' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: Membership) => row.public_id;
  protected readonly rowLabel = (row: Membership) => personName(row.user);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get('page')) || 1));
  protected readonly list = requestState(() => this.api.memberships(untracked(this.page)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, SETTINGS_ERRORS) : null;
  });

  constructor() {
    effect(() => {
      this.page();
      this.session.activeCompany();
      untracked(() => this.list.reload());
    });
  }

  protected open(membership: Membership): void {
    void this.router.navigate([membership.public_id], { relativeTo: this.route });
  }

  protected setPage(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
    });
  }
}
