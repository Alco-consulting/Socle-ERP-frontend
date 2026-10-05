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
import { catchError, map, of } from 'rxjs';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../../shared/ui/tabs/tabs';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TreasuryApi } from '../data-access/treasury-api';
import { AlcoReconciliationProposals } from './reconciliation-proposals';
import { RECONCILIATION_ERRORS, ReconciliationView } from './reconciliation-presentation';
import { ReconciliationScope } from './reconciliation-scope';
import { AlcoStatementLines } from './statement-lines';

const PARAM = { view: 'vue', account: 'compte', statement: 'releve', page: 'page' } as const;
const VIEWS: readonly ReconciliationView[] = [
  'a-rapprocher',
  'propositions',
  'rapprochees',
  'exclues',
];

/**
 * Comptabilité › Trésorerie › Rapprochements (V2.1, lot A6), on the API: the bank lines of
 * a treasury account (`statement-lines/`, per state), the server's proposals
 * (`reconciliation-proposals/`, confirmation) and, for a line, its reconciliations
 * (`reconciliations/?statement_line=`, A6.2) with the cancellation of the active one — the
 * bank relation only (A6.1). The account (by code), the statement, the view and the page
 * live in the URL. Every rule — proposals, amounts, differences, decisions — is the server's.
 */
@Component({
  selector: 'alco-reconciliation-page',
  imports: [
    ReactiveFormsModule,
    AlcoButton,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoLoading,
    AlcoPageHeader,
    AlcoReconciliationProposals,
    AlcoInput,
    AlcoStatementLines,
    AlcoTabPanel,
    AlcoTabs,
  ],
  templateUrl: './reconciliation-page.html',
  styleUrls: ['../../accounting/accounting-list.scss', './reconciliation-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconciliationPage {
  private readonly api = inject(TreasuryApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly tabs: readonly TabItem[] = [
    { id: 'a-rapprocher', label: 'À rapprocher' },
    { id: 'propositions', label: 'Propositions' },
    { id: 'rapprochees', label: 'Rapprochées' },
    { id: 'exclues', label: 'Exclues' },
  ];
  protected readonly day = isoDay;

  // ---- State of the screen, from the URL -------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly param = (name: string) => this.params().get(name)?.trim() || null;
  protected readonly view = computed<ReconciliationView>(() => {
    const value = this.param(PARAM.view);
    return VIEWS.includes(value as ReconciliationView)
      ? (value as ReconciliationView)
      : 'a-rapprocher';
  });
  protected readonly accountCode = computed(() => this.param(PARAM.account)?.toUpperCase() ?? null);
  protected readonly statementId = computed(() => this.param(PARAM.statement));
  protected readonly page = computed(() => Math.max(1, Number(this.params().get(PARAM.page)) || 1));

  // ---- The accounts of the company, and the one of the URL ----------------------------------
  protected readonly accounts = requestState(() => this.api.accounts());
  protected readonly accountChoices = computed(() => this.accounts.value()?.results ?? []);
  protected readonly accountsFailure = computed(() => {
    const error = this.accounts.error();
    return error ? toUserError(error, RECONCILIATION_ERRORS) : null;
  });
  protected readonly account = computed(() => {
    const code = this.accountCode();
    return code ? (this.accountChoices().find((item) => item.code === code) ?? null) : null;
  });
  protected readonly unknownAccount = computed(
    () => this.accounts.value() !== null && this.accountCode() !== null && this.account() === null,
  );

  // ---- The statements of the account ---------------------------------------------------------
  protected readonly statements = requestState(
    () => this.api.statements(untracked(this.account)?.public_id ?? ''),
    { immediate: false },
  );
  protected readonly statementChoices = computed(() => this.statements.value()?.results ?? []);
  protected readonly statement = computed(() => {
    const chosen = this.statementId();
    return chosen
      ? (this.statementChoices().find((item) => item.public_id === chosen) ?? null)
      : null;
  });

  /** What the panels list; `null` until the account (and the statement asked) are known. */
  protected readonly scope = computed<ReconciliationScope | null>(() => {
    const account = this.account();
    if (!account) {
      return null;
    }
    const statementId = this.statementId();
    if (statementId && !this.statement()) {
      return null;
    }
    return {
      account: account.public_id,
      accountCode: account.code,
      currency: account.currency,
      statement: statementId,
      view: this.view(),
      page: this.page(),
    };
  });
  protected readonly unknownStatement = computed(
    () =>
      this.statementId() !== null &&
      this.statements.value() !== null &&
      !this.statements.loading() &&
      this.statement() === null,
  );

  /** Decimals of each currency (`currencies/`), for display only. */
  protected readonly decimals = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly form = new FormGroup({
    account: new FormControl('', { nonNullable: true }),
    statement: new FormControl('', { nonNullable: true }),
  });
  /** The account chosen in the form (its statements are offered before « Afficher »). */
  private readonly formAccount = signal('');

  constructor() {
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      )
      .subscribe((decimals) => this.decimals.set(decimals));

    effect(() => {
      const account = this.account();
      if (account) {
        untracked(() => this.statements.reload());
      }
    });
    // A company with a single treasury account: it is the one shown.
    effect(() => {
      const choices = this.accountChoices();
      if (!this.accountCode() && choices.length === 1) {
        untracked(() => this.navigate({ [PARAM.account]: choices[0].code }, true));
      }
    });
    effect(() => {
      const code = this.account()?.code ?? this.accountCode() ?? '';
      const statement = this.statementId() ?? '';
      untracked(() => {
        this.form.setValue({ account: code, statement });
        this.formAccount.set(code);
      });
    });
    this.form.controls.account.valueChanges.subscribe((value) => {
      this.formAccount.set(value);
      if (this.form.controls.statement.value) {
        this.form.controls.statement.setValue('');
      }
    });
  }

  /** The statements offered by the form: those of the account shown, if it is the one chosen. */
  protected readonly formStatements = computed(() =>
    this.formAccount() === this.account()?.code ? this.statementChoices() : [],
  );

  protected show(): void {
    const value = this.form.getRawValue();
    this.navigate({
      [PARAM.account]: value.account || null,
      [PARAM.statement]: value.account === this.account()?.code ? value.statement || null : null,
      [PARAM.page]: null,
    });
  }

  protected setView(view: string): void {
    if (view === this.view()) {
      return;
    }
    this.navigate({
      [PARAM.view]: view === 'a-rapprocher' ? null : view,
      [PARAM.page]: null,
    });
  }

  protected setPage(page: number): void {
    this.navigate({ [PARAM.page]: page > 1 ? page : null });
  }

  /** A page past the end (the list got shorter): back to the first one. */
  protected firstPage(): void {
    this.navigate({ [PARAM.page]: null }, true);
  }

  protected showProposals(): void {
    this.setView('propositions');
  }

  protected clearStatement(): void {
    this.navigate({ [PARAM.statement]: null, [PARAM.page]: null });
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
