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
import { AlcoFilterBar } from '../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../shared/filters/search-bar';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { listPaging } from '../../shared/ui/pagination/page-size';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { TaxesApi } from './data-access/taxes-api';
import { RecordStatus, Tax, TaxUse } from './data-access/taxes-models';
import { TAX_ERRORS, rateText, taxUseLabel } from './taxes-presentation';

const PARAM = { search: 'q', usage: 'usage', status: 'etat', page: 'page' } as const;

/** « S'applique à » filter: the taxes usable on that side (a tax of both sides is). */
const USAGE_FILTERS: Readonly<Record<string, { label: string; uses: readonly TaxUse[] }>> = {
  ventes: { label: 'Ventes', uses: ['sale', 'both'] },
  achats: { label: 'Achats', uses: ['purchase', 'both'] },
};
const STATUSES: readonly { id: RecordStatus; label: string }[] = [
  { id: 'active', label: 'Actives' },
  { id: 'inactive', label: 'Inactives' },
];

/**
 * Comptabilité › Configuration › Taxes (`GET taxes/`, by name): Nom, Taux, S'applique à,
 * the account of each side and « Actif », switched from the row (a command; the server
 * decides). « Créer les taxes de Guinée » creates the usual taxes not yet present.
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
  styleUrls: ['../accounting/accounting-list.scss', './tax-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxListPage {
  private readonly api = inject(TaxesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly usageFilters = Object.entries(USAGE_FILTERS).map(([id, f]) => ({ id, ...f }));
  protected readonly statuses = STATUSES;
  protected readonly useLabel = taxUseLabel;
  protected readonly rateText = rateText;
  protected readonly canCreate = computed(() => this.session.can('taxes.create'));
  protected readonly canUpdate = computed(() => this.session.can('taxes.update'));
  /** The usual taxes come with the chart's accounts: Accounting reads the chart. */
  protected readonly canCreateDefaults = computed(
    () => this.canCreate() && this.session.can('accounting.read'),
  );

  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', label: 'Nom' },
    { key: 'rate', label: 'Taux', width: '9rem', numeric: true },
    { key: 'use', label: 'S’applique à', width: '11rem' },
    { key: 'sale_account', label: 'Compte des ventes', width: '10rem', hideBelow: 'laptop' },
    { key: 'purchase_account', label: 'Compte des achats', width: '10rem', hideBelow: 'laptop' },
    { key: 'active', label: 'Actif', width: '5rem' },
  ];
  /** « Actif » switched from the list: the server's answer, by tax. */
  private readonly activeSaved = signal<ReadonlyMap<string, boolean>>(new Map());
  protected readonly switching = signal<string | null>(null);
  protected readonly creatingDefaults = signal(false);
  protected readonly rowId = (row: Tax) => row.public_id;
  protected readonly rowLabel = (row: Tax) => row.name;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly usage = computed(() => {
    const value = this.params().get(PARAM.usage) ?? '';
    return value in USAGE_FILTERS ? value : '';
  });
  protected readonly status = computed<RecordStatus | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.some((status) => status.id === value) ? (value as RecordStatus) : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  /** 20 par page par défaut ; 40, 50 ou 100 au choix, dans l'adresse et retenu. */
  protected readonly paging = listPaging(this.params);

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(
    () => [this.usage() || null, this.status()].filter((v) => v !== null).length,
  );
  protected readonly hasCriteria = computed(() => this.activeFilterCount() > 0 || !!this.search());

  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const facets: SearchFacet[] = [];
    const usage = this.usage();
    if (usage) {
      const label = USAGE_FILTERS[usage].label;
      facets.push({ id: 'usage', kind: 'filter', label: 'S’applique à', value: label });
    }
    const status = this.status();
    if (status) {
      const label = STATUSES.find((item) => item.id === status)?.label ?? '';
      facets.push({ id: 'status', kind: 'filter', label: 'État', value: label });
    }
    return facets;
  });

  private readonly query = computed(() => ({
    search: this.search(),
    status: this.status(),
    uses: this.usage() ? USAGE_FILTERS[this.usage()].uses : [],
    page: this.page(),
    pageSize: this.paging.size(),
  }));
  protected readonly list = requestState(() => this.api.taxes(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, TAX_ERRORS) : null;
  });

  protected readonly filterForm = new FormGroup({
    usage: new FormControl('', { nonNullable: true }),
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
      this.filterForm.setValue({ usage: this.usage(), status: this.status() ?? '' });
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

  /** « Actif » of a row: the activate/deactivate command, the server decides. */
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

  /** « Créer les taxes de Guinée »: the server creates those not yet present. */
  protected async createDefaults(): Promise<void> {
    if (this.creatingDefaults()) {
      return;
    }
    this.creatingDefaults.set(true);
    try {
      const result = await firstValueFrom(this.api.createDefaultTaxes());
      const count = result.created.length;
      if (count > 0) {
        this.toast.success(
          `${count} taxe${count > 1 ? 's' : ''} de Guinée créée${count > 1 ? 's' : ''}.`,
        );
      } else {
        this.toast.info('Les taxes de Guinée existent déjà.');
      }
      this.list.reload();
    } catch (failure) {
      this.toast.error(toUserError(failure, TAX_ERRORS).title);
    } finally {
      this.creatingDefaults.set(false);
    }
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.usage]: value.usage || null,
      [PARAM.status]: value.status || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({
      [PARAM.search]: null,
      [PARAM.usage]: null,
      [PARAM.status]: null,
      [PARAM.page]: null,
    });
  }

  protected removeFacet(facet: SearchFacet): void {
    const param = { usage: PARAM.usage, status: PARAM.status }[facet.id];
    if (param) {
      this.navigate({ [param]: null, [PARAM.page]: null });
    }
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected setPageSize(size: number): void {
    this.navigate(this.paging.choose(size, PARAM.page));
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
