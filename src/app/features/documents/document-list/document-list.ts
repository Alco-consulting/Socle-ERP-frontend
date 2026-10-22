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

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFilterBar } from '../../../shared/filters/filter-bar';
import { AlcoStatusTabs, StatusTab } from '../../../shared/filters/status-tabs';
import { AlcoSearchBar, SearchFacet } from '../../../shared/filters/search-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { DocumentOpener } from '../data-access/document-opener';
import {
  DOCUMENT_PAGE_SIZE,
  DocumentQuery,
  DocumentsApi,
  StoredDocument,
} from '../data-access/documents-api';
import {
  DOCUMENT_ERRORS,
  DOCUMENT_RESOURCES,
  DOCUMENT_STATUS,
  fileKind,
  fileSize,
} from '../documents-presentation';

const PARAM = { search: 'q', status: 'etat', type: 'type', page: 'page' } as const;

type ListedStatus = NonNullable<DocumentQuery['status']>;
const STATUSES: readonly ListedStatus[] = ['active', 'replaced', 'deleted'];

/**
 * Documents › Documents, on the API (`GET documents/`): every supporting document the user
 * may read, with what it is attached to; searched, filtered by state and by kind of record,
 * opened through a signed link. A file is joined from its record (an entry…), never here.
 */
@Component({
  selector: 'alco-document-list',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFilterBar,
    AlcoFormField,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoSearchBar,
    AlcoStatusTabs,
    AlcoTable,
  ],
  templateUrl: './document-list.html',
  styleUrls: ['../../accounting/accounting-list.scss', './document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentListPage {
  private readonly api = inject(DocumentsApi);
  private readonly opener = inject(DocumentOpener);
  private readonly navigation = inject(NavigationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);

  protected readonly pageSize = DOCUMENT_PAGE_SIZE;
  /** The states in one click (the active documents by default). */
  protected readonly statusTabs: readonly StatusTab[] = [
    { id: null, label: 'Actives' },
    { id: 'replaced', label: 'Remplacées' },
    { id: 'deleted', label: 'Supprimées' },
  ];
  protected readonly resources = Object.entries(DOCUMENT_RESOURCES).map(([id, item]) => ({
    id,
    label: item.plural,
  }));
  protected readonly canDownload = computed(() => this.session.can('documents.download'));
  protected readonly size = fileSize;
  protected readonly kind = fileKind;
  protected readonly rowId = (row: StoredDocument) => row.public_id;
  protected readonly rowLabel = (row: StoredDocument) => row.original_name;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly search = computed(() => this.params().get(PARAM.search)?.trim() ?? '');
  protected readonly status = computed<ListedStatus | null>(() => {
    const value = this.params().get(PARAM.status) as ListedStatus | null;
    return value && STATUSES.includes(value) ? value : null;
  });
  protected readonly resourceType = computed(() => {
    const value = this.params().get(PARAM.type);
    return value && value in DOCUMENT_RESOURCES ? value : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly searchText = signal(this.route.snapshot.queryParamMap.get(PARAM.search) ?? '');
  private readonly searchTyped = new Subject<string>();

  protected readonly activeFilterCount = computed(
    () => (this.status() ? 1 : 0) + (this.resourceType() ? 1 : 0),
  );
  protected readonly hasCriteria = computed(() => this.activeFilterCount() > 0 || !!this.search());
  protected readonly facets = computed<readonly SearchFacet[]>(() => {
    const facets: SearchFacet[] = [];
    const status = this.status();
    if (status) {
      facets.push({
        id: 'status',
        kind: 'filter',
        label: 'État',
        value: DOCUMENT_STATUS[status].plural,
      });
    }
    const type = this.resourceType();
    if (type) {
      facets.push({
        id: 'type',
        kind: 'filter',
        label: 'Rattachées à',
        value: DOCUMENT_RESOURCES[type].plural,
      });
    }
    return facets;
  });

  /** The state is a column only when other states than the active one are listed. */
  protected readonly columns = computed<readonly TableColumn[]>(() => [
    { key: 'name', label: 'Pièce' },
    { key: 'resource', label: 'Rattachée à', width: '14rem', hideBelow: 'tablet' },
    { key: 'kind', label: 'Type', width: '6.5rem', hideBelow: 'laptop' },
    { key: 'size', label: 'Taille', width: '6rem', numeric: true, hideBelow: 'tablet' },
    { key: 'created_at', label: 'Ajoutée le', width: '8rem', hideBelow: 'tablet' },
    ...(this.status() && this.status() !== 'active'
      ? [{ key: 'status', label: 'État', width: '8.5rem' }]
      : []),
    { key: 'open', label: 'Ouvrir', width: '7rem' },
  ]);

  private readonly query = computed<DocumentQuery>(() => ({
    search: this.search(),
    status: this.status(),
    resourceType: this.resourceType(),
    page: this.page(),
  }));
  protected readonly list = requestState(() => this.api.list(untracked(this.query)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, DOCUMENT_ERRORS) : null;
  });
  protected readonly opening = signal<string | null>(null);
  protected readonly actionError = signal<UserError | null>(null);
  /** The entries' list, the usual place to join a file (empty state). */
  protected readonly entriesUrl = computed(() => {
    const url = '/app/comptabilite/ecritures';
    return this.navigation.canOpenUrl(url) ? url : null;
  });

  protected readonly filterForm = new FormGroup({
    status: new FormControl('', { nonNullable: true }),
    type: new FormControl('', { nonNullable: true }),
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
      this.filterForm.setValue({ status: this.status() ?? '', type: this.resourceType() ?? '' });
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

  protected statusOf(document: StoredDocument) {
    return DOCUMENT_STATUS[document.status];
  }

  protected resourceLabel(document: StoredDocument): string {
    return DOCUMENT_RESOURCES[document.resource_type]?.label ?? 'Autre enregistrement';
  }

  /** The record's screen, when it exists and the user may open it. */
  protected resourceUrl(document: StoredDocument): string | null {
    const url = DOCUMENT_RESOURCES[document.resource_type]?.url?.(document.resource_id);
    return url && this.navigation.canOpenUrl(url) ? url : null;
  }

  protected async open(document: StoredDocument): Promise<void> {
    this.opening.set(document.public_id);
    this.actionError.set(null);
    try {
      this.actionError.set(await this.opener.open(document));
    } catch (failure) {
      if (toApiError(failure).kind !== 'unauthenticated') {
        this.actionError.set(toUserError(failure, DOCUMENT_ERRORS));
      }
    } finally {
      this.opening.set(null);
    }
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    this.searchTyped.next(text);
  }

  protected applyFilters(): void {
    const { status, type } = this.filterForm.getRawValue();
    this.navigate({
      [PARAM.status]: status || null,
      [PARAM.type]: type || null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.searchText.set('');
    this.navigate({
      [PARAM.search]: null,
      [PARAM.status]: null,
      [PARAM.type]: null,
      [PARAM.page]: null,
    });
  }

  protected removeFacet(facet: SearchFacet): void {
    this.navigate({ [facet.id === 'type' ? PARAM.type : PARAM.status]: null, [PARAM.page]: null });
  }

  protected chooseStatus(status: string | null): void {
    this.navigate({ [PARAM.status]: status, [PARAM.page]: null });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
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
