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
import { Subject, catchError, debounceTime, map, of } from 'rxjs';

import { toUserError } from '../../../../core/errors/user-error';
import { requestState } from '../../../../core/http/request-state';
import { BreadcrumbService } from '../../../../core/navigation/route-trail';
import { SessionStore } from '../../../../core/session/session.store';
import { AlcoFilterBar, FavoriteOption } from '../../../../shared/filters/filter-bar';
import { AlcoSearchBar, SearchFacet } from '../../../../shared/filters/search-bar';
import { AlcoFormField } from '../../../../shared/forms/form-field';
import { AlcoInput } from '../../../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../../../shared/tables/table';
import { AlcoBadge } from '../../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../../shared/ui/pagination/pagination';
import { AlcoDomainTransfers } from '../../../transfers/domain-transfers';
import {
  PartnerRole,
  PartnerStatus,
  PartnerSummary,
  PartnerTag,
} from '../../data-access/partner-models';
import { PARTNER_PAGE_SIZE, PartnersApi } from '../../data-access/partners-api';
import {
  PARTNER_ERRORS,
  PARTNER_ROLES,
  PARTNER_STATUS,
  PARTNER_TRANSFER,
  roleLabel,
} from '../../partner-presentation';

/** The list's state lives in the URL: « Retour » and a shared link restore it. */
const PARAM = {
  search: 'q',
  role: 'role',
  status: 'etat',
  country: 'pays',
  tag: 'etiquette',
  page: 'page',
} as const;

const STATUSES: readonly PartnerStatus[] = ['active', 'inactive'];

const FAVORITES: readonly (FavoriteOption & { params: Params })[] = [
  { id: 'active', label: 'Tiers actifs', params: { [PARAM.status]: 'active' } },
  { id: 'inactive', label: 'Tiers désactivés', params: { [PARAM.status]: 'inactive' } },
];

const NO_FILTER: Params = {
  [PARAM.role]: null,
  [PARAM.status]: null,
  [PARAM.country]: null,
  [PARAM.tag]: null,
  [PARAM.page]: null,
};

/**
 * Tiers › Tous les tiers / Clients / Fournisseurs (`data.role` fixes the role of the last
 * two). Search, filters and pages are the server's (`GET partners/`); the browser neither
 * filters nor sorts (the API orders by code). Columns: what the list endpoint gives — no
 * request per row.
 */
@Component({
  selector: 'alco-partner-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDomainTransfers,
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
  templateUrl: './partner-list.html',
  styleUrl: './partner-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartnerListPage {
  private readonly api = inject(PartnersApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly trail = inject(BreadcrumbService).items;
  protected readonly session = inject(SessionStore);

  protected readonly transfer = PARTNER_TRANSFER;
  protected readonly favorites = FAVORITES;
  protected readonly roles = PARTNER_ROLES;
  protected readonly statuses = STATUSES.map((id) => ({ id, label: PARTNER_STATUS[id].label }));
  protected readonly roleLabel = roleLabel;
  protected readonly pageSize = PARTNER_PAGE_SIZE;

  protected readonly title = computed(() => this.trail().at(-1)?.label ?? 'Tiers');
  /** Clients / Fournisseurs screens: the role is the screen's, not a filter. */
  protected readonly fixedRole =
    (this.route.snapshot.data['role'] as PartnerRole | undefined) ?? null;
  protected readonly canCreate = computed(() => this.session.can('partners.create'));

  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '9rem' },
    { key: 'name', label: 'Nom' },
    { key: 'role', label: 'Rôle', hideBelow: 'tablet' },
    { key: 'country', label: 'Pays', hideBelow: 'tablet', width: '5rem' },
    { key: 'tax_identifier', label: 'Identifiant fiscal', hideBelow: 'laptop' },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: PartnerSummary) => row.public_id;
  protected readonly rowLabel = (row: PartnerSummary) => `${row.code} ${row.name}`;

  // ---- State read from the URL -------------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly role = computed<PartnerRole | null>(() => {
    if (this.fixedRole) {
      return this.fixedRole;
    }
    const value = this.params().get(PARAM.role);
    return PARTNER_ROLES.some((role) => role.id === value) ? (value as PartnerRole) : null;
  });
  protected readonly status = computed<PartnerStatus | null>(() => {
    const value = this.params().get(PARAM.status);
    return STATUSES.includes(value as PartnerStatus) ? (value as PartnerStatus) : null;
  });
  protected readonly country = computed(() => {
    const value = this.params().get(PARAM.country)?.trim().toUpperCase() ?? '';
    return /^[A-Z]{2}$/.test(value) ? value : null;
  });
  /** Odoo's « Étiquettes » (note backend 0045): the partners of one tag. */
  protected readonly tag = computed(() => this.params().get(PARAM.tag) || null);
  protected readonly tags = signal<readonly PartnerTag[]>([]);
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(
    () =>
      [this.fixedRole ? null : this.role(), this.status(), this.country(), this.tag()].filter(
        Boolean,
      ).length,
  );
  protected readonly hasCriteria = computed(() => this.activeFilterCount() > 0 || !!this.search());

  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const facets: SearchFacet[] = [];
    const role = this.role();
    if (role && !this.fixedRole) {
      const label = PARTNER_ROLES.find((item) => item.id === role)?.label ?? role;
      facets.push({ id: 'role', kind: 'filter', label: 'Rôle', value: label });
    }
    const status = this.status();
    if (status) {
      facets.push({
        id: 'status',
        kind: 'filter',
        label: 'État',
        value: PARTNER_STATUS[status].label,
      });
    }
    const country = this.country();
    if (country) {
      facets.push({ id: 'country', kind: 'filter', label: 'Pays', value: country });
    }
    const tag = this.tag();
    if (tag) {
      const name = this.tags().find((item) => item.public_id === tag)?.name ?? '…';
      facets.push({ id: 'tag', kind: 'filter', label: 'Étiquette', value: name });
    }
    return facets;
  });

  // ---- Data (server side) ------------------------------------------------------------
  private readonly query = computed(() => ({
    search: this.search(),
    role: this.role(),
    status: this.status(),
    country: this.country(),
    tag: this.tag(),
    page: this.page(),
  }));

  protected readonly list = requestState(() => this.api.list(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, PARTNER_ERRORS) : null;
  });

  /** What the export follows: the role and the state (the only criteria it accepts). */
  protected readonly exportParameters = computed(() => {
    const parameters: Record<string, string> = {};
    const role = this.role();
    const status = this.status();
    if (role) {
      parameters['role'] = role;
    }
    if (status) {
      parameters['status'] = status;
    }
    return parameters;
  });
  protected readonly exportScope = computed(() => {
    const role = this.role();
    const status = this.status();
    const who =
      role === 'customer'
        ? 'clients'
        : role === 'supplier'
          ? 'fournisseurs'
          : role === 'other'
            ? 'tiers ni clients ni fournisseurs'
            : 'tous les tiers';
    const state = status === 'active' ? ' actifs' : status === 'inactive' ? ' désactivés' : '';
    const ignored =
      this.search() || this.country()
        ? ' (la recherche et le pays ne s’appliquent pas à l’export)'
        : '';
    return `${who}${state}${ignored}`;
  });

  protected readonly filterForm = new FormGroup({
    role: new FormControl<string>('', { nonNullable: true }),
    status: new FormControl<string>('', { nonNullable: true }),
    country: new FormControl<string>('', { nonNullable: true }),
    tag: new FormControl<string>('', { nonNullable: true }),
  });

  constructor() {
    // One request per change of criteria; the previous one is cancelled.
    effect(() => {
      this.query();
      untracked(() => this.list.reload());
    });
    // A page that no longer exists (fewer results): back to the first one.
    effect(() => {
      const error = this.list.error();
      if (error?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ [PARAM.page]: null }, true));
      }
    });
    effect(() => {
      this.filterForm.setValue({
        role: this.fixedRole ? '' : (this.role() ?? ''),
        status: this.status() ?? '',
        country: this.country() ?? '',
        tag: this.tag() ?? '',
      });
    });
    this.api
      .tags()
      .pipe(catchError(() => of([] as readonly PartnerTag[])))
      .subscribe((list) => this.tags.set(list));
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

  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.role]: this.fixedRole ? null : value.role || null,
      [PARAM.status]: value.status || null,
      [PARAM.country]: value.country.trim().toUpperCase() || null,
      [PARAM.tag]: value.tag || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({ ...NO_FILTER, [PARAM.search]: null });
  }

  protected removeFacet(facet: SearchFacet): void {
    const param = {
      role: PARAM.role,
      status: PARAM.status,
      country: PARAM.country,
      tag: PARAM.tag,
    }[facet.id];
    if (param) {
      this.navigate({ [param]: null, [PARAM.page]: null });
    }
  }

  protected applyFavorite(id: string): void {
    const favorite = FAVORITES.find((item) => item.id === id);
    if (favorite) {
      this.searchText.set('');
      this.navigate({ ...NO_FILTER, [PARAM.search]: null, ...favorite.params });
    }
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  protected badgeOf(row: PartnerSummary): (typeof PARTNER_STATUS)[PartnerStatus] {
    return PARTNER_STATUS[row.status];
  }

  protected open(row: PartnerSummary): void {
    void this.router.navigate([row.public_id], { relativeTo: this.route });
  }

  protected retry(): void {
    this.list.reload();
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
