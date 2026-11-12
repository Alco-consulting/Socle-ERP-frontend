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
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar } from '../../../shared/filters/filter-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { listPaging } from '../../../shared/ui/pagination/page-size';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  ACCOUNTING_REFERENTIAL_ERRORS,
  JOURNAL_TYPES,
  RECORD_STATUS,
  journalTypeLabel,
} from '../accounting-presentation';
import { ActiveInactive, Journal, JournalType } from '../data-access/accounting-models';
import { AccountingApi } from '../data-access/accounting-api';

const PARAM = { type: 'type', status: 'etat', code: 'code', page: 'page' } as const;
const STATUSES: readonly ActiveInactive[] = ['active', 'inactive'];

/**
 * Comptabilité › Journaux as Odoo lists them (`GET accounting/journals/`, by code): Nom du
 * journal, Type, Code court, Compte (Odoo's « Compte par défaut »), Devise and « Actif »,
 * switched from the row (a command; the server decides). « Créer les journaux usuels »
 * creates Ventes, Achats and Opérations diverses, without an account. Filters of the API only
 * (type, state, exact code — no text search for journals); the list's state lives in the URL.
 */
@Component({
  selector: 'alco-journal-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
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
  styleUrls: ['../accounting-list.scss', './journal-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalListPage {
  private readonly api = inject(AccountingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  protected readonly types = JOURNAL_TYPES;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: RECORD_STATUS[id].label }));
  protected readonly typeLabel = journalTypeLabel;
  protected readonly canManage = computed(() => this.session.can('accounting.manage_journals'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', label: 'Nom du journal' },
    { key: 'type', label: 'Type', width: '11rem' },
    { key: 'code', label: 'Code court', width: '7rem' },
    { key: 'account', label: 'Compte', hideBelow: 'laptop' },
    { key: 'currency', label: 'Devise', width: '6rem', hideBelow: 'tablet' },
    { key: 'active', label: 'Actif', width: '5rem' },
  ];
  /** « Actif » switched from the list: the server's answer, by journal. */
  private readonly activeSaved = signal<ReadonlyMap<string, boolean>>(new Map());
  protected readonly switching = signal<string | null>(null);
  protected readonly creatingUsual = signal(false);
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
  /** 20 par page par défaut ; 40, 50 ou 100 au choix, dans l'adresse et retenu. */
  protected readonly paging = listPaging(this.params);

  protected readonly activeFilterCount = computed(
    () => [this.type(), this.status(), this.code()].filter(Boolean).length,
  );
  private readonly query = computed(() => ({
    journalType: this.type(),
    status: this.status(),
    code: this.code(),
    page: this.page(),
    pageSize: this.paging.size(),
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

  protected active(journal: Journal): boolean {
    return this.activeSaved().get(journal.public_id) ?? journal.status === 'active';
  }

  /** « Actif » of a row: the deactivate / reactivate command, the server decides. */
  protected async setActive(journal: Journal, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    this.switching.set(journal.public_id);
    try {
      const saved = await firstValueFrom(this.api.setJournalActive(journal.public_id, wanted));
      const active = saved.status === 'active';
      this.activeSaved.update((states) => new Map(states).set(saved.public_id, active));
      this.toast.success(`Journal ${saved.code} ${active ? 'réactivé' : 'désactivé'}.`);
    } catch (failure) {
      box.checked = !wanted;
      this.toast.error(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS).title);
    } finally {
      this.switching.set(null);
    }
  }

  /** « Créer les journaux usuels »: the server creates those whose code is free. */
  protected async createUsual(): Promise<void> {
    if (this.creatingUsual()) {
      return;
    }
    this.creatingUsual.set(true);
    try {
      const result = await firstValueFrom(this.api.createUsualJournals());
      const count = result.created.length;
      if (count > 0) {
        const codes = result.created.map((journal) => journal.code).join(', ');
        this.toast.success(
          `${count} journa${count > 1 ? 'ux usuels créés' : 'l usuel créé'} : ${codes}.`,
        );
      } else {
        this.toast.info('Les journaux usuels existent déjà.');
      }
      this.list.reload();
    } catch (failure) {
      this.toast.error(toUserError(failure, ACCOUNTING_REFERENTIAL_ERRORS).title);
    } finally {
      this.creatingUsual.set(false);
    }
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

  protected setPageSize(size: number): void {
    this.navigate(this.paging.choose(size, PARAM.page));
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
