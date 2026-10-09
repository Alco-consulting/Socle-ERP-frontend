import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, firstValueFrom, map } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFilterBar, GroupOption } from '../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../shared/filters/search-bar';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn, TableGroup } from '../../shared/tables/table';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { TAX_PAGE_SIZE, TaxesApi } from './data-access/taxes-api';
import { RecordStatus, Tax, TaxUse } from './data-access/taxes-models';
import { TAX_ERRORS, TAX_USES, taxScopeLabel, taxUseLabel } from './taxes-presentation';

const PARAM = { search: 'q', use: 'type', status: 'etat', group: 'groupe', page: 'page' } as const;

/** Odoo's « Type de taxe » filter: « Ventes ou Achats » unless another is chosen. */
const USE_FILTERS: Readonly<Record<string, { label: string; uses: readonly TaxUse[] }>> = {
  '': { label: 'Ventes ou Achats', uses: ['sale', 'purchase'] },
  ventes: { label: 'Ventes', uses: ['sale'] },
  achats: { label: 'Achats', uses: ['purchase'] },
  aucun: { label: 'Aucun', uses: ['none'] },
  tous: { label: 'Tous les types', uses: [] },
};
const STATUSES: readonly { id: RecordStatus; label: string }[] = [
  { id: 'active', label: 'Actives' },
  { id: 'inactive', label: 'Inactives' },
];
const GROUP_OPTIONS: readonly GroupOption[] = [{ id: 'type', label: 'Type de taxe' }];

/**
 * Comptabilité › Configuration › Taxes, as Odoo's list (`GET taxes/`): Nom de la taxe,
 * Description, Type de taxe, Portée de la taxe, Libellé sur les factures and « Actif »,
 * switched from the row (a command; the server decides). « Ventes ou Achats » by default.
 */
@Component({
  selector: 'alco-tax-list',
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
    AlcoSearchBar,
    AlcoTable,
  ],
  templateUrl: './tax-list.html',
  styleUrls: ['../accounting/accounting-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxListPage {
  private readonly api = inject(TaxesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly useFilters = Object.entries(USE_FILTERS).map(([id, f]) => ({ id, ...f }));
  protected readonly statuses = STATUSES;
  protected readonly groupOptions = GROUP_OPTIONS;
  protected readonly pageSize = TAX_PAGE_SIZE;
  protected readonly useLabel = taxUseLabel;
  protected readonly scopeLabel = taxScopeLabel;
  protected readonly canCreate = computed(() => this.session.can('taxes.create'));
  protected readonly canUpdate = computed(() => this.session.can('taxes.update'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', label: 'Nom de la taxe' },
    { key: 'description', label: 'Description', hideBelow: 'tablet' },
    { key: 'use', label: 'Type de taxe', width: '9rem' },
    { key: 'scope', label: 'Portée de la taxe', hideBelow: 'laptop' },
    { key: 'invoice_label', label: 'Libellé sur les factures', hideBelow: 'laptop' },
    { key: 'active', label: 'Actif', width: '5rem' },
  ];
  /** « Actif » switched from the list: the server's answer, by tax. */
  private readonly activeSaved = signal<ReadonlyMap<string, boolean>>(new Map());
  protected readonly switching = signal<string | null>(null);
  protected readonly rowId = (row: Tax) => row.public_id;
  protected readonly rowLabel = (row: Tax) => row.name;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly use = computed(() => {
    const value = this.params().get(PARAM.use) ?? '';
    return value in USE_FILTERS ? value : '';
  });
  protected readonly status = computed<RecordStatus | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.some((status) => status.id === value) ? (value as RecordStatus) : null;
  });
  protected readonly groupBy = computed(() =>
    GROUP_OPTIONS.some((option) => option.id === this.params().get(PARAM.group))
      ? this.params().get(PARAM.group)
      : null,
  );
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(
    () => [this.use() === 'tous' ? null : 1, this.status()].filter((v) => v !== null).length,
  );
  protected readonly hasCriteria = computed(
    () => this.use() !== 'tous' || this.status() !== null || !!this.search(),
  );

  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const facets: SearchFacet[] = [];
    if (this.use() !== 'tous') {
      facets.push({
        id: 'use',
        kind: 'filter',
        label: 'Type de taxe',
        value: USE_FILTERS[this.use()].label,
      });
    }
    const status = this.status();
    if (status) {
      const label = STATUSES.find((item) => item.id === status)?.label ?? '';
      facets.push({ id: 'status', kind: 'filter', label: 'État', value: label });
    }
    if (this.groupBy()) {
      facets.push({ id: 'group', kind: 'group', label: 'Regroupé par', value: 'Type de taxe' });
    }
    return facets;
  });

  private readonly query = computed(() => ({
    search: this.search(),
    status: this.status(),
    uses: USE_FILTERS[this.use()].uses,
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.taxes(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  /** Rows of the page grouped by Odoo's « Type de taxe », in Odoo's order. */
  protected readonly groups = computed<readonly TableGroup<Tax>[] | null>(() => {
    if (!this.groupBy()) {
      return null;
    }
    return TAX_USES.map((use) => ({
      key: use.id,
      label: use.label,
      rows: this.rows().filter((tax) => tax.type_tax_use === use.id),
    })).filter((group) => group.rows.length > 0);
  });
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, TAX_ERRORS) : null;
  });

  protected readonly filterForm = new FormGroup({
    use: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
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
      this.filterForm.setValue({ use: this.use(), status: this.status() ?? '' });
    });
    this.searchTyped
      .pipe(
        debounceTime(300),
        map((text) => text.trim()),
        takeUntilDestroyed(),
      )
      .subscribe((text) =>
        this.navigate({ [PARAM.search]: text || null, [PARAM.page]: null }, true),
      );
  }

  protected active(tax: Tax): boolean {
    return this.activeSaved().get(tax.public_id) ?? tax.status === 'active';
  }

  /** Odoo's « Actif » of a row: the activate/deactivate command, the server decides. */
  protected async setActive(tax: Tax, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    this.switching.set(tax.public_id);
    try {
      const saved = await firstValueFrom(this.api.setTaxActive(tax.public_id, wanted));
      const active = saved.status === 'active';
      this.activeSaved.update((map) => new Map(map).set(saved.public_id, active));
      this.toast.success(`Taxe ${saved.name} ${active ? 'activée' : 'désactivée'}.`);
    } catch (failure) {
      box.checked = !wanted;
      this.toast.error(toUserError(failure, TAX_ERRORS).title);
    } finally {
      this.switching.set(null);
    }
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.use]: value.use || null,
      [PARAM.status]: value.status || null,
      [PARAM.page]: null,
    });
  }

  /** Back to Odoo's default: « Ventes ou Achats », no search. */
  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({
      [PARAM.search]: null,
      [PARAM.use]: null,
      [PARAM.status]: null,
      [PARAM.page]: null,
    });
  }

  protected removeFacet(facet: SearchFacet): void {
    if (facet.id === 'use') {
      this.navigate({ [PARAM.use]: 'tous', [PARAM.page]: null });
    } else if (facet.id === 'status') {
      this.navigate({ [PARAM.status]: null, [PARAM.page]: null });
    } else if (facet.id === 'group') {
      this.navigate({ [PARAM.group]: null });
    }
  }

  protected setGroupBy(groupBy: string | null): void {
    this.navigate({ [PARAM.group]: groupBy });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected open(tax: Tax): void {
    void this.router.navigate([tax.public_id], { relativeTo: this.route });
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
