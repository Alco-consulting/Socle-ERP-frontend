import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar } from '../../../shared/filters/filter-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  JOURNAL_TYPES,
  RECORD_STATUS,
  journalTypeLabel,
} from '../accounting-presentation';
import { ActiveInactive, Journal, JournalType } from '../data-access/accounting-models';
import { AccountingApi, JOURNAL_PAGE_SIZE } from '../data-access/accounting-api';

const PARAM = { type: 'type', status: 'etat', code: 'code', page: 'page' } as const;
const STATUSES: readonly ActiveInactive[] = ['active', 'inactive'];

/**
 * Comptabilité › Journaux, on the API (`GET accounting/journals/`): filters of the API only
 * (type, state, exact code — the API has no text search for journals), its pages and its
 * order. The list's state lives in the URL.
 */
@Component({
  selector: 'alco-journal-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFilterBar,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './journal-list.html',
  styleUrl: '../accounting-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalListPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  protected readonly types = JOURNAL_TYPES;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: RECORD_STATUS[id].label }));
  protected readonly pageSize = JOURNAL_PAGE_SIZE;
  protected readonly typeLabel = journalTypeLabel;
  protected readonly canManage = computed(() => this.session.can('accounting.manage_journals'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '8rem' },
    { key: 'name', label: 'Nom' },
    { key: 'type', label: 'Type' },
    { key: 'currency', label: 'Devise', hideBelow: 'tablet' },
    { key: 'numbering', label: 'Numérotation', hideBelow: 'laptop' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: Journal) => row.public_id;
  protected readonly rowLabel = (row: Journal) => `${row.code} ${row.name}`;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly type = computed<JournalType | null>(() => {
    const value = this.params().get(PARAM.type);
    return JOURNAL_TYPES.some((type) => type.id === value) ? (value as JournalType) : null;
  });
  protected readonly status = computed<ActiveInactive | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.includes(value as ActiveInactive) ? (value as ActiveInactive) : null;
  });
  protected readonly code = computed(() => this.params().get(PARAM.code)?.trim() || null);
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly activeFilterCount = computed(
    () => [this.type(), this.status(), this.code()].filter(Boolean).length,
  );
  private readonly query = computed(() => ({
    journalType: this.type(),
    status: this.status(),
    code: this.code(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.journals(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, ACCOUNTING_REFERENTIAL_ERRORS) : null;
  });

  protected readonly filterForm = new FormGroup({
    type: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    code: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      this.query();
      untracked(() => this.list.reload());
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() => {
      this.filterForm.setValue({
        type: this.type() ?? '',
        status: this.status() ?? '',
        code: this.code() ?? '',
      });
    });
  }

  protected statusLook(journal: Journal) {
    return RECORD_STATUS[journal.status];
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.type]: value.type || null,
      [PARAM.status]: value.status || null,
      [PARAM.code]: value.code.trim() || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.navigate({
      [PARAM.type]: null,
      [PARAM.status]: null,
      [PARAM.code]: null,
      [PARAM.page]: null,
    });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(journal: Journal): void {
    void this.router.navigate([journal.public_id], { relativeTo: this.route });
  }

  private navigate(params: Params, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
