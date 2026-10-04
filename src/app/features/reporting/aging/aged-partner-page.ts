import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { AGED_DOCUMENT_PAGE_SIZE, AgingApi } from '../data-access/aging-api';
import { AgedDocument, AgingRole } from '../data-access/aging-models';
import { AlcoAgedSummary } from './aged-summary';
import { AGING_ERRORS, DOCUMENT_KINDS, ROLE_TITLES, bucketLabel } from './aging-presentation';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One partner of the aged balance (`GET reporting/aged-balance/partners/<id>/`) on the
 * reference date of the URL: its summary and its open documents, as the server returns them
 * (installment with its bucket and days past due, invoice without due dates, unapplied
 * payment or credit note). `?tranche=<code>` asks the server for one bucket (lot A5.1): it
 * chooses and pages that bucket's installments — nothing is filtered here. Each document
 * leads to its installment and its entry.
 */
@Component({
  selector: 'alco-aged-partner-page',
  imports: [
    RouterLink,
    AlcoAgedSummary,
    AlcoAmountPipe,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './aged-partner-page.html',
  styleUrl: './aging.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgedPartnerPage {
  private readonly api = inject(AgingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly navigation = inject(NavigationService);

  protected readonly role: AgingRole =
    (this.route.snapshot.data['aging'] as AgingRole | undefined) ?? 'customer';
  protected readonly title = ROLE_TITLES[this.role];
  protected readonly pageSize = AGED_DOCUMENT_PAGE_SIZE;
  protected readonly day = isoDay;
  protected readonly kinds = DOCUMENT_KINDS;
  protected readonly accounting = `${APP_ROOT}/comptabilite`;
  protected readonly canOpenDues = computed(() =>
    this.navigation.canOpenUrl(`${APP_ROOT}/comptabilite/echeances`),
  );

  private readonly id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly asOf = computed(() => {
    const value = this.params().get('au')?.trim();
    return value && ISO_DATE.test(value) ? value : null;
  });
  protected readonly bucket = computed(() => this.params().get('tranche')?.trim() || null);
  protected readonly page = computed(() => Math.max(1, Number(this.params().get('page')) || 1));
  private readonly query = computed(() => ({
    id: this.id(),
    asOf: this.asOf(),
    bucket: this.bucket(),
    page: this.page(),
  }));

  protected readonly report = requestState(
    () => {
      const query = untracked(this.query);
      return query.asOf
        ? this.api.agedPartner(query.id, {
            role: this.role,
            asOf: query.asOf,
            bucket: query.bucket,
            page: query.page,
          })
        : EMPTY;
    },
    { immediate: false },
  );
  protected readonly failure = computed(() => {
    const error = this.report.error();
    return error ? toUserError(error, AGING_ERRORS) : null;
  });
  /** The bucket the server says it listed (its own label from its bounds). */
  protected readonly bucketName = computed(() => {
    const bucket = this.report.value()?.bucket;
    return bucket ? bucketLabel(bucket) : null;
  });
  /** The documents exactly as the server returned them (the bucket's, when one is asked). */
  protected readonly documents = computed<readonly AgedDocument[]>(
    () => this.report.value()?.results ?? [],
  );
  protected readonly label = bucketLabel;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'kind', label: 'Nature' },
    { key: 'entry', label: 'Écriture' },
    { key: 'due', label: 'Échéance', width: '8rem' },
    { key: 'late', label: 'Retard', numeric: true, hideBelow: 'tablet' },
    { key: 'amount', label: 'Montant', numeric: true, hideBelow: 'laptop' },
    { key: 'open', label: 'Ouvert', numeric: true },
  ];
  protected readonly rowId = (row: AgedDocument) => `${row.kind}:${row.due_item ?? row.line}`;
  protected readonly decimals = toSignal(
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      ),
    { initialValue: new Map<string, number>() },
  );

  constructor() {
    effect(() => {
      this.query();
      untracked(() => this.report.reload());
    });
    effect(() => {
      const loaded = this.report.value();
      if (loaded) {
        untracked(() =>
          this.breadcrumbs.nameCurrent(`${loaded.partner.code} — ${loaded.partner.name}`),
        );
      }
    });
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected kindLabel(document: AgedDocument): string {
    return DOCUMENT_KINDS[document.kind];
  }

  protected bucketOf(document: AgedDocument): string | null {
    const found = this.report.value()?.buckets.find((item) => item.code === document.bucket);
    return found ? bucketLabel(found) : null;
  }

  /** Another bucket (or all of them): its own list, from its first page. */
  protected bucketQuery(code: string | null): Params {
    return { tranche: code, page: null };
  }

  protected setPage(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
    });
  }
}
