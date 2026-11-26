import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import { isZeroDecimal } from '../../../shared/utils/decimal';
import { PartnersApi } from '../../partners/data-access/partners-api';
import {
  JOURNAL_BOOK_PAGE_SIZE,
  JOURNAL_BOOK_PRINT_SIZE,
  ReportingApi,
} from '../data-access/reporting-api';
import { JournalBook, JournalBookEntry } from '../data-access/reporting-models';
import {
  AlcoReportPeriod,
  Period,
  PeriodChoice,
  periodFromUrl,
  periodParams,
} from '../report-period/report-period';

/**
 * Comptabilité › Analyse › Livre-journal (note backend 0068): the posted entries of the
 * period in date order, each with its lines, then the totals of each journal and of the book;
 * « Imprimer » reads every page and prints the whole book. Every figure is the server's.
 */
@Component({
  selector: 'alco-journal-book-page',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoErrorState,
    AlcoLoading,
    AlcoPagination,
    AlcoReportPeriod,
  ],
  templateUrl: './journal-book-page.html',
  styleUrl: './journal-book-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalBookPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly reporting = inject(ReportingApi);
  private readonly partners = inject(PartnersApi);
  private readonly toast = inject(AlcoToastService);
  private readonly injector = inject(Injector);
  protected readonly session = inject(SessionStore);

  protected readonly pageSize = JOURNAL_BOOK_PAGE_SIZE;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly dates = computed(() => periodFromUrl(this.params(), localToday(), 'mois'));
  protected readonly periodKind = computed(() => this.dates().kind);
  protected readonly anchor = computed(() => this.dates().anchor);
  protected readonly period = computed<Period>(() => this.dates().period);
  protected readonly page = signal(1);

  private readonly currencies = toSignal(
    this.partners.currencies().pipe(
      map((found) => found.results),
      catchError(() => of([])),
    ),
    { initialValue: [] },
  );
  protected readonly company = computed(() => this.session.activeCompany());
  protected readonly currency = computed(() => this.company()?.currency ?? '');
  protected readonly decimals = computed(
    () => this.currencies().find((item) => item.code === this.currency())?.decimal_places ?? 0,
  );

  protected readonly book = requestState(() => this.load(), { immediate: false });
  protected readonly failure = computed(() => {
    const error = this.book.error();
    return error ? toUserError(error) : null;
  });
  /** Every entry of the period, read to print the whole book; null on screen. */
  protected readonly printed = signal<readonly JournalBookEntry[] | null>(null);
  protected readonly printing = signal(false);
  protected readonly entries = computed(() => this.printed() ?? this.book.value()?.results ?? []);

  constructor() {
    effect(() => {
      this.period();
      untracked(() => {
        this.page.set(1);
        this.book.reload();
      });
    });
  }

  protected choosePeriod(choice: PeriodChoice): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: periodParams(choice, this.anchor(), this.period(), 'mois'),
      queryParamsHandling: 'merge',
    });
  }

  protected isZero(value: string): boolean {
    return isZeroDecimal(value);
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.book.reload();
  }

  /** Every page read, then the browser's printing of the whole book. */
  protected async print(): Promise<void> {
    const book = this.book.value();
    if (!book || this.printing()) {
      return;
    }
    this.printing.set(true);
    const period = this.period();
    try {
      const all: JournalBookEntry[] = [];
      const pages = Math.max(1, Math.ceil(book.count / JOURNAL_BOOK_PRINT_SIZE));
      for (let page = 1; page <= pages; page++) {
        const found = await firstValueFrom(
          this.reporting.journalBook(period.from, period.to, page, JOURNAL_BOOK_PRINT_SIZE),
        );
        all.push(...found.results);
      }
      this.printed.set(all);
      afterNextRender(
        () => {
          window.print();
          this.printed.set(null);
          this.printing.set(false);
        },
        { injector: this.injector },
      );
    } catch {
      this.toast.error('Le livre-journal n’a pas pu être chargé pour l’impression. Réessayez.');
      this.printing.set(false);
    }
  }

  private load(): Observable<JournalBook> {
    const period = untracked(this.period);
    return this.reporting.journalBook(period.from, period.to, untracked(this.page));
  }
}
