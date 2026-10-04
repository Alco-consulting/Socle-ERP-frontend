import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { AlcoFilterBar } from '../../../shared/filters/filter-bar';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../../shared/ui/tabs/tabs';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { AccountingApi } from '../data-access/accounting-api';
import { EntriesApi } from '../data-access/entries-api';
import { LetteringStatus } from '../data-access/lettering-models';
import { AlcoLetterableLines } from './letterable-lines';
import { AlcoLetteringHistory } from './lettering-history';
import { LETTERING_ERRORS, LINE_VIEWS, LineView } from './lettering-presentation';
import { AlcoLetteringProposals } from './lettering-proposals';
import { LetteringScope } from './lettering-scope';

/** The three views of the screen (`vue` of the URL; the lines when absent). */
type View = 'lignes' | 'propositions' | 'lettrages';

const PARAM = {
  view: 'vue',
  account: 'compte',
  partner: 'tiers',
  from: 'du',
  to: 'au',
  state: 'etat',
  reference: 'reference',
  page: 'page',
} as const;
const VIEWS: readonly View[] = ['lignes', 'propositions', 'lettrages'];
const LINE_VIEW_IDS = LINE_VIEWS.map((item) => item.id);
const LETTERING_STATUSES: readonly LetteringStatus[] = ['active', 'cancelled'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The account and the partner of the URL, found by the server (`null`: no such code). */
interface Found {
  readonly account: string | null | undefined;
  readonly partner: string | null | undefined;
}

/**
 * Comptabilité › Comptabilité › Lettrage (V2.1, lot A4), on the API: the lines to letter
 * (`letterable-lines/`, selection, preview, lettering), the server's proposals
 * (`letterings/proposals/`, confirmation) and the letterings made (`letterings/`, each with
 * its record, its unlettering and its history). The account and the partner are filtered by
 * code (readable, shareable URL), found by the server first; the view, dates, state and page
 * live in the URL too. Every rule — letterable lines, amounts, residual, proposals — is the
 * server's.
 */
@Component({
  selector: 'alco-lettering-page',
  imports: [
    ReactiveFormsModule,
    AlcoButton,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFilterBar,
    AlcoFormField,
    AlcoInput,
    AlcoLetterableLines,
    AlcoLetteringHistory,
    AlcoLetteringProposals,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTabPanel,
    AlcoTabs,
  ],
  templateUrl: './lettering-page.html',
  styleUrls: ['../accounting-list.scss', './lettering-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LetteringPage {
  private readonly accounting = inject(AccountingApi);
  private readonly entries = inject(EntriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly tabs: readonly TabItem[] = [
    { id: 'lignes', label: 'Lignes à lettrer' },
    { id: 'propositions', label: 'Propositions' },
    { id: 'lettrages', label: 'Lettrages' },
  ];
  protected readonly lineViews = LINE_VIEWS;
  protected readonly letteringStatuses = [
    { id: 'active', label: 'Actifs' },
    { id: 'cancelled', label: 'Annulés' },
  ];

  // ---- State of the screen, from the URL -------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly param = (name: string) => this.params().get(name)?.trim() || null;
  protected readonly view = computed<View>(() => {
    const value = this.param(PARAM.view);
    return VIEWS.includes(value as View) ? (value as View) : 'lignes';
  });
  protected readonly accountCode = computed(() => this.param(PARAM.account));
  protected readonly partnerCode = computed(() => this.param(PARAM.partner));
  protected readonly dateFrom = computed(() => this.date(PARAM.from));
  protected readonly dateTo = computed(() => this.date(PARAM.to));
  protected readonly lineView = computed<LineView>(() => {
    const value = this.param(PARAM.state);
    return LINE_VIEW_IDS.includes(value as LineView) ? (value as LineView) : 'open';
  });
  protected readonly letteringStatus = computed<LetteringStatus | null>(() => {
    const value = this.param(PARAM.state);
    return LETTERING_STATUSES.includes(value as LetteringStatus)
      ? (value as LetteringStatus)
      : null;
  });
  protected readonly reference = computed(() => this.param(PARAM.reference));
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  protected readonly activeFilterCount = computed(() => {
    const view = this.view();
    const common = [this.accountCode(), this.partnerCode()];
    if (view === 'propositions') {
      return common.filter(Boolean).length;
    }
    const dates = this.dateFrom() || this.dateTo();
    const state = view === 'lignes' ? this.lineView() !== 'open' : this.letteringStatus();
    const reference = view === 'lettrages' ? this.reference() : null;
    return [...common, dates, state, reference].filter(Boolean).length;
  });

  // ---- The codes of the URL, found by the server (one request per code) -----------------
  private readonly codes = computed(() => ({
    account: this.accountCode(),
    partner: this.partnerCode(),
  }));
  protected readonly found = requestState(() => this.find(untracked(this.codes)), {
    immediate: false,
  });
  protected readonly findFailure = computed(() => {
    const error = this.found.error();
    return error ? toUserError(error, LETTERING_ERRORS) : null;
  });
  protected readonly unknownCode = computed(() => {
    const found = this.found.value();
    if (found?.account === null) {
      return `Aucun compte de cette société n’a le code « ${this.accountCode()} ».`;
    }
    if (found?.partner === null) {
      return `Aucun tiers de cette société n’a le code « ${this.partnerCode()} ».`;
    }
    return null;
  });
  /** What the panels list; `null` until the codes are found. */
  protected readonly scope = computed<LetteringScope | null>(() => {
    const found = this.found.value();
    if (!found || this.found.loading() || this.unknownCode()) {
      return null;
    }
    return {
      account: found.account ?? null,
      partner: found.partner ?? null,
      dateFrom: this.dateFrom(),
      dateTo: this.dateTo(),
      lineView: this.lineView(),
      letteringStatus: this.letteringStatus(),
      reference: this.reference(),
      page: this.page(),
    };
  });

  /** Decimals of each currency (`currencies/`), for display only. */
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly filterForm = new FormGroup({
    account: new FormControl('', { nonNullable: true }),
    partner: new FormControl('', { nonNullable: true }),
    dateFrom: new FormControl('', { nonNullable: true }),
    dateTo: new FormControl('', { nonNullable: true }),
    lineView: new FormControl<string>('open', { nonNullable: true }),
    letteringStatus: new FormControl('', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      )
      .subscribe((decimals) => this.decimals.set(decimals));

    effect(() => {
      this.codes();
      untracked(() => this.found.reload());
    });
    effect(() => {
      this.filterForm.setValue({
        account: this.accountCode() ?? '',
        partner: this.partnerCode() ?? '',
        dateFrom: this.dateFrom() ?? '',
        dateTo: this.dateTo() ?? '',
        lineView: this.lineView(),
        letteringStatus: this.letteringStatus() ?? '',
        reference: this.reference() ?? '',
      });
    });
  }

  protected setView(view: string): void {
    if (view === this.view()) {
      return;
    }
    // Another list: its own state and page; the account, partner and dates stay.
    this.navigate({
      [PARAM.view]: view === 'lignes' ? null : view,
      [PARAM.state]: null,
      [PARAM.reference]: null,
      [PARAM.page]: null,
    });
  }

  protected applyFilters(): void {
    const value = this.filterForm.getRawValue();
    const view = this.view();
    const state =
      view === 'lignes'
        ? value.lineView === 'open'
          ? null
          : value.lineView
        : view === 'lettrages'
          ? value.letteringStatus || null
          : null;
    this.navigate({
      [PARAM.account]: value.account.trim() || null,
      [PARAM.partner]: value.partner.trim() || null,
      [PARAM.from]: view === 'propositions' ? this.dateFrom() : value.dateFrom || null,
      [PARAM.to]: view === 'propositions' ? this.dateTo() : value.dateTo || null,
      [PARAM.state]: state,
      [PARAM.reference]: view === 'lettrages' ? value.reference.trim() || null : null,
      [PARAM.page]: null,
    });
  }

  protected resetFilters(): void {
    this.navigate(
      Object.fromEntries(
        Object.values(PARAM)
          .filter((name) => name !== PARAM.view)
          .map((name) => [name, null]),
      ),
    );
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  /** A page past the end (the list got shorter): back to the first one. */
  protected firstPage(): void {
    this.navigate({ [PARAM.page]: null }, true);
  }

  /**
   * The account and the partner of the URL by their exact code: the server finds them
   * (`accounting/accounts/?code=`, `partners/?code=`); `null` when the code matches nothing.
   */
  private find(codes: { account: string | null; partner: string | null }): Observable<Found> {
    const account = codes.account
      ? this.accounting.accountByCode(codes.account).pipe(map((found) => found?.public_id ?? null))
      : of(undefined);
    const partner = codes.partner
      ? this.entries.partnerByCode(codes.partner).pipe(map((found) => found?.public_id ?? null))
      : of(undefined);
    return forkJoin({ account, partner });
  }

  private date(name: string): string | null {
    const value = this.param(name);
    return value && ISO_DATE.test(value) ? value : null;
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
