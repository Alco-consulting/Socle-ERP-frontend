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
import { Subject, catchError, debounceTime, firstValueFrom, map, of } from 'rxjs';

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
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { CURRENCY_ERRORS, dayText, inverseRateText, rateText } from './currencies-presentation';
import { CURRENCY_PAGE_SIZE, CurrenciesApi } from './data-access/currencies-api';
import { Currency, CurrencyRate, CurrencyStatus } from './data-access/currencies-models';

const PARAM = { search: 'q', status: 'etat', page: 'page' } as const;

const STATUSES: readonly { id: CurrencyStatus; label: string }[] = [
  { id: 'active', label: 'Actives' },
  { id: 'inactive', label: 'Inactives' },
];

/**
 * Comptabilité › Configuration › Devises, as Odoo lists them: the shared ISO catalogue
 * (`GET currencies/`, the active ones first), with the rate in force today in the company's
 * currency (`GET currencies/rates/current/`): « Dernière mise à jour », « Unité par GNF » and
 * « GNF par unité ». « Actif » is switched from the row by the holders of the global
 * `currencies.update`; the company's own currency stays active.
 */
@Component({
  selector: 'alco-currency-list',
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
  templateUrl: './currency-list.html',
  styleUrls: ['../accounting/accounting-list.scss', './currency-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrencyListPage {
  private readonly api = inject(CurrenciesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly statuses = STATUSES;
  protected readonly pageSize = CURRENCY_PAGE_SIZE;
  protected readonly canCreate = computed(() => this.session.can('currencies.create'));
  protected readonly canUpdate = computed(() => this.session.can('currencies.update'));
  /** The company's currency (« GNF »): 1 by definition, no rate. */
  protected readonly reference = computed(() => this.session.activeCompany()?.currency ?? '');

  protected readonly columns = computed<readonly TableColumn[]>(() => {
    const reference = this.reference();
    return [
      { key: 'code', label: 'Devise', width: '6rem' },
      { key: 'symbol', label: 'Symbole', width: '6rem' },
      { key: 'name', label: 'Nom' },
      { key: 'rate_date', label: 'Dernière mise à jour', width: '10rem', hideBelow: 'tablet' },
      { key: 'inverse', label: `Unité par ${reference}`, width: '10rem', numeric: true },
      {
        key: 'rate',
        label: `${reference} par unité`,
        width: '10rem',
        numeric: true,
        hideBelow: 'laptop',
      },
      { key: 'active', label: 'Actif', width: '5rem' },
    ];
  });
  /** « Actif » switched from the list: the server's answer, by currency. */
  private readonly activeSaved = signal<ReadonlyMap<string, boolean>>(new Map());
  protected readonly switching = signal<string | null>(null);
  protected readonly rowId = (row: Currency) => row.public_id;
  protected readonly rowLabel = (row: Currency) => `${row.code} — ${row.name}`;
  protected readonly dayText = dayText;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly status = computed<CurrencyStatus | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.some((status) => status.id === value) ? (value as CurrencyStatus) : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(() => (this.status() ? 1 : 0));
  protected readonly hasCriteria = computed(() => this.activeFilterCount() > 0 || !!this.search());
  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const status = this.status();
    const label = STATUSES.find((item) => item.id === status)?.label;
    return label ? [{ id: 'status', kind: 'filter', label: 'État', value: label }] : [];
  });

  private readonly query = computed(() => ({
    search: this.search(),
    status: this.status(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.currencies(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, CURRENCY_ERRORS) : null;
  });

  /** The rate in force today of each currency, by code (none: no rate yet, or unreadable). */
  private readonly current = toSignal(
    this.api.currentRates().pipe(
      map((rates) => new Map(rates.map((rate) => [rate.currency, rate]))),
      catchError(() => of(new Map<string, CurrencyRate>())),
    ),
    { initialValue: new Map<string, CurrencyRate>() },
  );

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

  protected rateOf(currency: Currency): CurrencyRate | undefined {
    return this.current().get(currency.code);
  }

  protected isReference(currency: Currency): boolean {
    return currency.code === this.reference();
  }

  /** « Unité par GNF »: 1 for the company's currency, else 1 ÷ its rate in force. */
  protected inverseOf(currency: Currency): string {
    if (this.isReference(currency)) {
      return '1';
    }
    const rate = this.rateOf(currency);
    return rate ? inverseRateText(rate.rate) : '';
  }

  /** « GNF par unité »: the rate the server keeps. */
  protected rateTextOf(currency: Currency): string {
    if (this.isReference(currency)) {
      return '1';
    }
    const rate = this.rateOf(currency);
    return rate ? rateText(rate.rate) : '';
  }

  protected active(currency: Currency): boolean {
    return this.activeSaved().get(currency.public_id) ?? currency.status === 'active';
  }

  /** « Actif » of a row: the catalogue's status, the server decides. */
  protected async setActive(currency: Currency, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    this.switching.set(currency.public_id);
    try {
      const saved = await firstValueFrom(this.api.setCurrencyActive(currency.public_id, wanted));
      const active = saved.status === 'active';
      this.activeSaved.update((states) => new Map(states).set(saved.public_id, active));
      this.toast.success(`Devise ${saved.code} ${active ? 'activée' : 'désactivée'}.`);
    } catch (failure) {
      box.checked = !wanted;
      this.toast.error(toUserError(failure, CURRENCY_ERRORS).title);
    } finally {
      this.switching.set(null);
    }
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    this.navigate({
      [PARAM.status]: this.filterForm.getRawValue().status || null,
      [PARAM.page]: null,
    });
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

  protected open(currency: Currency): void {
    void this.router.navigate([currency.public_id], { relativeTo: this.route });
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
