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
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { listPaging } from '../../shared/ui/pagination/page-size';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { rateText } from '../taxes/taxes-presentation';
import { InvoicingApi } from './data-access/invoicing-api';
import { Product, RecordStatus } from './data-access/invoicing-models';
import { INVOICING_ERRORS } from './invoicing-presentation';

const PARAM = { search: 'q', status: 'etat', page: 'page' } as const;
const STATUSES: readonly { id: RecordStatus; label: string }[] = [
  { id: 'active', label: 'Actifs' },
  { id: 'inactive', label: 'Inactifs' },
];

/**
 * Comptabilité › Clients ▾ / Fournisseurs ▾ › Produits (`GET invoicing/products/`, by name):
 * Référence, Nom, Prix de vente, Compte de vente, Compte d'achat, TVA and « Actif », switched
 * from the row (a command; the server decides).
 */
@Component({
  selector: 'alco-product-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
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
  templateUrl: './product-list.html',
  styleUrls: ['../accounting/accounting-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductListPage {
  private readonly api = inject(InvoicingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly statuses = STATUSES;
  protected readonly rateText = rateText;
  protected readonly canManage = computed(() => this.session.can('invoicing.manage_products'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Référence', width: '9rem' },
    { key: 'name', label: 'Nom' },
    { key: 'sale_price', label: 'Prix de vente HT', width: '10rem', numeric: true },
    { key: 'sale_account', label: 'Compte de vente', width: '9rem', hideBelow: 'laptop' },
    { key: 'purchase_account', label: 'Compte d’achat', width: '9rem', hideBelow: 'laptop' },
    { key: 'tax', label: 'TVA', width: '8rem', hideBelow: 'tablet' },
    { key: 'active', label: 'Actif', width: '5rem' },
  ];
  private readonly activeSaved = signal<ReadonlyMap<string, boolean>>(new Map());
  protected readonly switching = signal<string | null>(null);
  protected readonly rowId = (row: Product) => row.public_id;
  protected readonly rowLabel = (row: Product) => row.name;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly status = computed<RecordStatus | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.some((status) => status.id === value) ? (value as RecordStatus) : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  /** 20 par page par défaut ; 40, 50 ou 100 au choix, dans l'adresse et retenu. */
  protected readonly paging = listPaging(this.params);

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(() => (this.status() ? 1 : 0));
  protected readonly hasCriteria = computed(() => this.activeFilterCount() > 0 || !!this.search());
  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const status = this.status();
    if (!status) {
      return [];
    }
    const label = STATUSES.find((item) => item.id === status)?.label ?? '';
    return [{ id: 'status', kind: 'filter', label: 'État', value: label }];
  });

  private readonly query = computed(() => ({
    search: this.search(),
    status: this.status(),
    page: this.page(),
    pageSize: this.paging.size(),
  }));
  protected readonly list = requestState(() => this.api.products(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, INVOICING_ERRORS) : null;
  });

  protected readonly filterForm = new FormGroup({
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
      this.filterForm.setValue({ status: this.status() ?? '' });
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

  protected active(product: Product): boolean {
    return this.activeSaved().get(product.public_id) ?? product.status === 'active';
  }

  protected async setActive(product: Product, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    this.switching.set(product.public_id);
    try {
      const saved = await firstValueFrom(this.api.setProductActive(product.public_id, wanted));
      const active = saved.status === 'active';
      this.activeSaved.update((saves) => new Map(saves).set(saved.public_id, active));
      this.toast.success(`Produit ${saved.name} ${active ? 'activé' : 'désactivé'}.`);
    } catch (failure) {
      box.checked = !wanted;
      this.toast.error(toUserError(failure, INVOICING_ERRORS).title);
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
    this.navigate({ [PARAM.status]: value.status || null, [PARAM.page]: null });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({ [PARAM.search]: null, [PARAM.status]: null, [PARAM.page]: null });
  }

  protected removeFacet(facet: SearchFacet): void {
    if (facet.id === 'status') {
      this.navigate({ [PARAM.status]: null, [PARAM.page]: null });
    }
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected setPageSize(size: number): void {
    this.navigate(this.paging.choose(size, PARAM.page));
  }

  protected open(product: Product): void {
    void this.router.navigate([product.public_id], { relativeTo: this.route });
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
