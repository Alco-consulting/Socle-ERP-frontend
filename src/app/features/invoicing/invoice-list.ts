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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, map } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFilterBar } from '../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../shared/filters/search-bar';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { INVOICE_PAGE_SIZE, InvoicingApi } from './data-access/invoicing-api';
import {
  InvoiceKind,
  InvoiceStatus,
  InvoiceSummary,
  PaymentState,
} from './data-access/invoicing-models';
import { INVOICE_STATUS, INVOICING_ERRORS, KINDS, PAYMENT_STATE } from './invoicing-presentation';

const PARAM = { search: 'q', status: 'etat', page: 'page' } as const;
const STATUSES: readonly InvoiceStatus[] = ['draft', 'posted', 'cancelled'];

/**
 * A list of one kind of document (route data `kind`): customer or supplier invoices, or
 * their credit notes (`GET invoicing/invoices/?kind=`, newest first). Numéro, the partner,
 * Date, totals, État and Paiement as the server gives them; search and état in the URL.
 */
@Component({
  selector: 'alco-invoice-list',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
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
    AlcoSearchBar,
    AlcoTable,
  ],
  templateUrl: './invoice-list.html',
  styleUrls: ['../accounting/accounting-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceListPage {
  private readonly api = inject(InvoicingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);

  protected readonly spec = KINDS[this.route.snapshot.data['kind'] as InvoiceKind];
  protected readonly pageSize = INVOICE_PAGE_SIZE;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: INVOICE_STATUS[id].label }));
  protected readonly canCreate = computed(
    () => this.spec.creatable && this.session.can('invoicing.create'),
  );

  protected readonly columns: readonly TableColumn[] = [
    { key: 'number', label: 'Numéro', width: '9rem' },
    { key: 'partner', label: this.spec.partnerLabel },
    { key: 'date', label: 'Date', width: '7rem' },
    { key: 'untaxed', label: 'Total HT', width: '9rem', numeric: true, hideBelow: 'laptop' },
    { key: 'total', label: 'Total TTC', width: '9rem', numeric: true },
    { key: 'status', label: 'État', width: '9rem' },
    { key: 'payment', label: 'Paiement', width: '11rem', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (row: InvoiceSummary) => row.public_id;
  protected readonly rowLabel = (row: InvoiceSummary) =>
    `${this.spec.word} ${row.number || 'brouillon'}`;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly status = computed<InvoiceStatus | null>(() => {
    const value = this.params().get(PARAM.status) as InvoiceStatus | null;
    return value && STATUSES.includes(value) ? value : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));
  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();
  protected readonly activeFilterCount = computed(() => (this.status() ? 1 : 0));
  protected readonly hasCriteria = computed(() => this.activeFilterCount() > 0 || !!this.search());
  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const status = this.status();
    return status
      ? [{ id: 'status', kind: 'filter', label: 'État', value: INVOICE_STATUS[status].label }]
      : [];
  });

  private readonly query = computed(() => ({
    kind: this.spec.kind,
    search: this.search(),
    status: this.status(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.invoices(untracked(this.query)), {
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
    effect(() => this.filterForm.setValue({ status: this.status() ?? '' }));
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

  protected statusOf(row: InvoiceSummary) {
    return INVOICE_STATUS[row.status];
  }

  protected paymentOf(state: PaymentState | null) {
    return state ? PAYMENT_STATE[state] : null;
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

  protected open(row: InvoiceSummary): void {
    void this.router.navigate([row.public_id], { relativeTo: this.route });
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
