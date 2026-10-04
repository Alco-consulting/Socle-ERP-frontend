import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { isZeroDecimal } from '../../../shared/utils/decimal';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { AGED_PAGE_SIZE, AgingApi } from '../data-access/aging-api';
import { AgedAmounts, AgedPartnerRow, AgingBucket, AgingRole } from '../data-access/aging-models';
import { AlcoAgedSummary } from './aged-summary';
import { AGING_ERRORS, ROLE_TITLES, bucketDescription, bucketLabel } from './aging-presentation';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The day the browser is in, proposed in the field only (never sent until confirmed). */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Comptabilité › Analyse › Balance clients / fournisseurs (V2.1, lot A5): the aged balance
 * of `GET reporting/aged-balance/` (role from the route) on a reference date the user chooses
 * and confirms (`?au=`; nothing is asked before). Summary, buckets, partners and amounts are
 * the server's — the buckets are those the API returns (the company's policy). Drill-down:
 * a partner (or one of its buckets) → its open documents → installment → entry.
 */
@Component({
  selector: 'alco-aged-balance-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAgedSummary,
    AlcoAmountPipe,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './aged-balance-page.html',
  styleUrl: './aging.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgedBalancePage {
  private readonly api = inject(AgingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly role: AgingRole =
    (this.route.snapshot.data['aging'] as AgingRole | undefined) ?? 'customer';
  protected readonly title = ROLE_TITLES[this.role];
  protected readonly pageSize = AGED_PAGE_SIZE;
  protected readonly day = isoDay;
  protected readonly label = bucketLabel;
  protected readonly describe = bucketDescription;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly asOf = computed(() => {
    const value = this.params().get('au')?.trim();
    return value && ISO_DATE.test(value) ? value : null;
  });
  protected readonly page = computed(() => Math.max(1, Number(this.params().get('page')) || 1));
  private readonly query = computed(() => ({ asOf: this.asOf(), page: this.page() }));

  protected readonly report = requestState(
    () => {
      const query = untracked(this.query);
      return query.asOf
        ? this.api.agedBalance({ role: this.role, asOf: query.asOf, page: query.page })
        : EMPTY;
    },
    { immediate: false },
  );
  protected readonly failure = computed(() => {
    const error = this.report.error();
    return error ? toUserError(error, AGING_ERRORS) : null;
  });
  protected readonly buckets = computed<readonly AgingBucket[]>(
    () => this.report.value()?.buckets ?? [],
  );
  protected readonly columns = computed<readonly TableColumn[]>(() => [
    { key: 'partner', label: 'Tiers' },
    ...this.buckets().map((bucket): TableColumn => ({
      key: `bucket:${bucket.code}`,
      label: bucketLabel(bucket),
      numeric: true,
      hideBelow: 'laptop',
    })),
    { key: 'total', label: 'Total', numeric: true },
    { key: 'balance', label: 'Solde', numeric: true },
  ]);
  protected readonly rowId = (row: AgedPartnerRow) => row.partner.public_id;
  protected readonly decimals = toSignal(
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      ),
    { initialValue: new Map<string, number>() },
  );

  protected readonly form = new FormGroup({
    asOf: new FormControl(today(), { nonNullable: true, validators: Validators.required }),
  });

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => {
        if (query.asOf) {
          this.form.controls.asOf.setValue(query.asOf);
          this.report.reload();
        }
      });
    });
    effect(() => {
      if (this.report.error()?.kind === 'not-found' && untracked(this.page) > 1) {
        untracked(() => this.navigate({ page: null }, true));
      }
    });
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  /** The bucket's amount of a row (by the code the API gave). */
  protected amountOf(amounts: AgedAmounts, code: string): string {
    return amounts.buckets.find((bucket) => bucket.code === code)?.amount ?? '0';
  }

  protected nonZero(amount: string): boolean {
    return !isZeroDecimal(amount);
  }

  protected show(): void {
    const value = this.form.controls.asOf.value;
    if (!value || !ISO_DATE.test(value)) {
      this.form.markAllAsTouched();
      return;
    }
    this.navigate({ au: value, page: null });
  }

  protected setPage(page: number): void {
    this.navigate({ page: page > 1 ? page : null });
  }

  protected partnerLink(row: AgedPartnerRow): string[] {
    return [row.partner.public_id];
  }

  protected partnerQuery(code?: string): Params {
    return { au: this.asOf(), ...(code ? { tranche: code } : {}) };
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
