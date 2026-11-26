import { NgTemplateOutlet, formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { SessionStore } from '../../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../../shared/forms/autocomplete';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { localToday } from '../../../shared/utils/dates';
import {
  formatDecimal,
  isZeroDecimal,
  normalizeDecimalInput,
  subtractDecimals,
  trimDecimalZeros,
} from '../../../shared/utils/decimal';
import { EntriesApi } from '../../accounting/data-access/entries-api';
import { LetterableLine } from '../../accounting/data-access/lettering-models';
import { LetteringApi } from '../../accounting/data-access/lettering-api';
import { PartnersApi } from '../../partners/data-access/partners-api';
import {
  TransactionCounterpart,
  TreasuryAccount,
  TreasuryTransaction,
} from '../data-access/reconciliation-models';
import { TREASURY_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import { TREASURY_ERRORS } from '../treasury-presentation';

const TREASURY = `${APP_ROOT}/comptabilite/tresorerie`;

const TRANSFER = 'Virement interne';

/**
 * Ce que la ligne solde, comme les boutons d'Odoo : « Partenaire » (et l'une de ses factures
 * non payées) ou « Compte » (tout compte du plan) ; rien de choisi : les deux boutons. Les
 * virements entre journaux se font dans Trésorerie › Virements (plus de modèle de rapprochement).
 */
type Counterpart = 'choose' | 'partner' | 'account';

/** An account of a selection field: its code, its name beside. */
const accountOption = (account: { public_id: string; code: string; name: string }) => ({
  id: account.public_id,
  label: account.code,
  detail: account.name,
});

/** A row of the table: a line of the journal, or the line typed (new, or being completed). */
type DisplayRow =
  | { readonly key: string; readonly entry: true; readonly row: Row | null }
  | { readonly key: string; readonly entry: false; readonly row: Row };

/** A row of the list, in Odoo's words: the date, the partner and label, what it settled. */
interface Row {
  readonly transaction: TreasuryTransaction;
  readonly day: string;
  readonly partner: string;
  readonly label: string;
  readonly counterpart: string;
  readonly done: boolean;
  readonly toReconcile: boolean;
  readonly inflow: string;
  readonly outflow: string;
  readonly running: string;
}

/**
 * Odoo's « Réconciliation bancaire » of a bank or cash journal, as its list (note backend
 * 0044): the line typed in the table, every field on one row (date, label, the partner and one
 * of its unpaid invoices, or none for an advance on its account; the money in or out; the
 * balance after it), then the journal's lines with their running balance. A line is recorded,
 * posted and lettered by the server at once: no lettering to do afterwards. As Odoo's, the
 * line is set against « Partenaire » or « Compte ».
 */
@Component({
  selector: 'alco-transactions-page',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    AlcoAutocomplete,
    AlcoButton,
    AlcoErrorState,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
  ],
  templateUrl: './transactions-page.html',
  styleUrl: './transactions-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsPage {
  private readonly treasury = inject(TreasuryApi);
  private readonly entries = inject(EntriesApi);
  private readonly lettering = inject(LetteringApi);
  private readonly partners = inject(PartnersApi);
  private readonly navigation = inject(NavigationService);
  private readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toast = inject(AlcoToastService);

  protected readonly pageSize = TREASURY_PAGE_SIZE;
  protected readonly operationsUrl = `${TREASURY}/operations`;

  private readonly code = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('compte'))),
    { initialValue: this.route.snapshot.queryParamMap.get('compte') },
  );

  protected readonly accounts = requestState(() =>
    this.treasury.accounts().pipe(map((found) => found.results)),
  );
  /** The journal's account (`?compte=`), else the first one. */
  protected readonly account = computed<TreasuryAccount | null>(() => {
    const list = this.accounts.value() ?? [];
    return list.find((item) => item.code === this.code()) ?? list[0] ?? null;
  });

  private readonly currencies = requestState(() =>
    this.partners.currencies().pipe(
      map((found) => found.results),
      catchError(() => of([])),
    ),
  );
  protected readonly decimals = computed(() => {
    const currency = this.account()?.currency;
    return this.currencies.value()?.find((item) => item.code === currency)?.decimal_places ?? 0;
  });

  /** Asked once the journal is known (see the constructor). */
  private readonly accountId = () => untracked(this.account)?.public_id ?? '';
  protected readonly balance = requestState(() => this.treasury.balance(this.accountId()), {
    immediate: false,
  });
  protected readonly page = signal(1);
  protected readonly lines = requestState(
    () => this.treasury.transactions(this.accountId(), untracked(this.page)),
    { immediate: false },
  );

  protected readonly rows = computed<readonly Row[]>(() =>
    (this.lines.value()?.results ?? []).map((transaction) => this.rowOf(transaction)),
  );
  /**
   * The table's rows, as Odoo's list: the new line typed on top, or the line « à rapprocher »
   * being completed in its own place (note backend 0050).
   */
  protected readonly displayRows = computed<readonly DisplayRow[]>(() => {
    const taken = this.reconciling();
    const typed = this.canRecord() && this.editing();
    const rows: DisplayRow[] = this.rows().map((row) =>
      typed && taken?.public_id === row.transaction.public_id
        ? { key: row.transaction.public_id, entry: true, row }
        : { key: row.transaction.public_id, entry: false, row },
    );
    return typed && !taken ? [{ key: 'new', entry: true, row: null }, ...rows] : rows;
  });

  // ---- The line typed at the top -------------------------------------------------------
  protected readonly canRecord = computed(
    () =>
      this.session.can('treasury.create') &&
      this.session.can('treasury.confirm') &&
      this.session.can('treasury.account') &&
      this.session.can('accounting.validate'),
  );
  protected readonly editing = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalid = signal<string | null>(null);
  private idempotencyKey = crypto.randomUUID();

  protected readonly form = new FormGroup({
    date: new FormControl(localToday(), { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    partner: new FormControl<AutocompleteOption | null>(null),
    /** The public id of the partner's open line (an invoice); '' : none. */
    line: new FormControl('', { nonNullable: true }),
    /** « Compte »: any account of the chart that takes entries. */
    account: new FormControl<AutocompleteOption | null>(null),
    /** Where the invoice's difference with the amount goes, as Odoo's « marquer comme payé ». */
    writeOff: new FormControl<AutocompleteOption | null>(null),
    amountIn: new FormControl('', { nonNullable: true }),
    amountOut: new FormControl('', { nonNullable: true }),
  });
  protected readonly value = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    {
      initialValue: this.form.getRawValue(),
    },
  );
  /** The partner's unpaid invoices (its open lines), read when the partner is chosen. */
  protected readonly openLines = signal<readonly LetterableLine[]>([]);
  protected readonly counterpart = signal<Counterpart>('choose');
  /** A line « à rapprocher » taken back in the typed row: its counterpart is chosen. */
  protected readonly reconciling = signal<TreasuryTransaction | null>(null);
  protected readonly hasPartner = computed(
    () => this.counterpart() === 'partner' && this.value().partner !== null,
  );
  /**
   * The difference between the invoice chosen and the amount typed (note backend 0065), shown
   * with its currency; '' when they match or nothing is chosen.
   */
  protected readonly gap = computed(() => {
    const value = this.value();
    const line = this.openLines().find((item) => item.public_id === value.line);
    if (!this.hasPartner() || !line) {
      return '';
    }
    const typed = normalizeDecimalInput(
      (line.side === 'debit' ? value.amountIn : value.amountOut).trim(),
    );
    if (!typed) {
      return '';
    }
    const difference = subtractDecimals(line.open_amount, typed);
    if (isZeroDecimal(difference)) {
      return '';
    }
    return `${this.money(difference.replace(/^-/, ''))} ${line.currency}`;
  });
  /** The balance after the line typed, as Odoo's « Solde courant » of the new row. */
  protected readonly preview = computed(() => {
    const found = this.balance.value();
    const taken = this.reconciling();
    if (taken) {
      // A line already in the journal: its own place in the balance.
      return taken.running_balance === null
        ? ''
        : `${this.money(taken.running_balance)} ${taken.currency}`;
    }
    if (!found) {
      return '';
    }
    const value = this.value();
    const amount = (text: string) => Number(normalizeDecimalInput(text.trim()) || 0);
    const after = Number(found.balance) + amount(value.amountIn) - amount(value.amountOut);
    return `${this.money(after.toFixed(this.decimals()))} ${found.currency}`;
  });

  protected readonly searchPartners: AutocompleteSearch = (term) =>
    this.entries.partners(term).pipe(
      map((found) =>
        found.map((partner) => ({
          id: partner.public_id,
          label: partner.name,
          detail: partner.code,
        })),
      ),
    );
  /** Every account of the chart that takes entries, by its code or name. */
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.entries.postableAccounts(term).pipe(map((found) => found.map(accountOption)));

  constructor() {
    // Left with a line begun (an amount typed), as Odoo: kept « à rapprocher ».
    inject(DestroyRef).onDestroy(() => this.keepBegunLine());
    // The journal known: its balance and its lines.
    effect(() => {
      if (this.account()) {
        untracked(() => this.reload());
      }
    });
    const controls = this.form.controls;
    controls.partner.valueChanges.subscribe((partner) => this.readOpenLines(partner));
    controls.line.valueChanges.subscribe((id) => this.fillFromLine(id));
    // One amount: money in, or money out.
    controls.amountIn.valueChanges.subscribe((amount) => {
      if (amount.trim() && controls.amountOut.value) {
        controls.amountOut.setValue('', { emitEvent: false });
      }
    });
    controls.amountOut.valueChanges.subscribe((amount) => {
      if (amount.trim() && controls.amountIn.value) {
        controls.amountIn.setValue('', { emitEvent: false });
      }
    });
  }

  protected lineLabel(line: LetterableLine): string {
    const name = line.document_reference || line.entry.entry_number;
    const day = formatDate(line.entry_date, 'dd/MM/yyyy', this.locale);
    return `${name} · ${day} · ${this.money(line.open_amount)} ${line.currency}`;
  }

  protected money(value: string): string {
    return formatDecimal(trimDecimalZeros(value, this.decimals()), this.decimals());
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.lines.reload();
  }

  protected open(): void {
    this.editing.set(true);
    setTimeout(() => this.focus('description'));
  }

  /** « Partenaire », « Compte », or back to the three buttons. */
  protected choose(counterpart: Counterpart): void {
    const controls = this.form.controls;
    controls.partner.setValue(null);
    controls.account.setValue(null, { emitEvent: false });
    this.invalid.set(null);
    this.counterpart.set(counterpart);
    const field = { partner: 'partner', account: 'account' } as const;
    if (counterpart !== 'choose') {
      setTimeout(() => this.focus(field[counterpart]));
    }
  }

  protected ignore(): void {
    this.reset();
    this.editing.set(false);
  }

  /**
   * A line « à rapprocher »: completed in its own place, as Odoo's — « Partenaire » or
   * « Compte » chosen on it, every field still to change (note backend 0050).
   */
  protected completeRow(transaction: TreasuryTransaction, counterpart: Counterpart): void {
    this.reconcileRow(transaction);
    this.choose(counterpart);
  }

  private reconcileRow(transaction: TreasuryTransaction): void {
    // A new line begun on top is kept « à rapprocher » first, as Odoo saves it.
    this.keepBegunLine(true);
    this.reset(transaction.operation_date);
    this.reconciling.set(transaction);
    const amount = trimDecimalZeros(transaction.amount, this.decimals());
    const out = transaction.direction === 'outflow';
    const controls = this.form.controls;
    controls.description.setValue(transaction.description || transaction.reference);
    controls.amountIn.setValue(out ? '' : amount, { emitEvent: false });
    controls.amountOut.setValue(out ? amount : '', { emitEvent: false });
    this.editing.set(true);
  }

  /** Entrée in the row: the line saved, a new one to type (a choice in a list stays a choice). */
  protected onEnter(event: Event): void {
    if (event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    void this.add(false);
  }

  /** « Enregistrer » (`close`), or Entrée in the row (a new line to type). */
  protected async add(close: boolean): Promise<void> {
    const account = this.account();
    if (!account || this.saving()) {
      return;
    }
    this.error.set(null);
    const value = this.form.getRawValue();
    const amountIn = normalizeDecimalInput(value.amountIn.trim());
    const amountOut = normalizeDecimalInput(value.amountOut.trim());
    const amount = amountIn || amountOut;
    if (!value.date || !amount || Number(amount) <= 0) {
      this.invalid.set('Saisissez la date et un montant en entrée ou en sortie.');
      this.focus(value.date ? 'amountIn' : 'date');
      return;
    }
    const counterpart = this.counterpart();
    const reconciling = this.reconciling();
    const missing = {
      // Nothing chosen: the line is kept (or stays) « à rapprocher » (note backend 0050).
      choose: null,
      partner: value.partner ? null : 'Choisissez le partenaire.',
      account: value.account ? null : 'Choisissez le compte.',
    }[counterpart];
    // A line « à rapprocher » with nothing picked yet: its changes kept, still waiting.
    if (missing && !reconciling) {
      this.invalid.set(missing);
      return;
    }
    let chosen: TransactionCounterpart = {
      partner: counterpart === 'partner' ? (value.partner?.id ?? null) : null,
      // An invoice of the partner.
      settled_line: counterpart === 'partner' ? value.line || null : null,
      // « Compte », or with a partner and no invoice: an account instead of the contact's.
      offset_account:
        counterpart === 'account' || (counterpart === 'partner' && !value.line)
          ? (value.account?.id ?? null)
          : null,
    };
    // An invoice not paid exactly: its difference settled on this account, if chosen.
    const writeOff = counterpart === 'partner' && value.line && this.gap() ? value.writeOff : null;
    if (writeOff) {
      chosen = { ...chosen, write_off_account: writeOff.id };
    }
    this.invalid.set(null);
    this.saving.set(true);
    try {
      await firstValueFrom(
        reconciling
          ? this.treasury.reconcileTransaction(reconciling.public_id, {
              operation_date: value.date,
              description: value.description.trim(),
              direction: amountIn ? 'inflow' : 'outflow',
              amount,
              ...chosen,
            })
          : this.treasury.recordTransaction(account.public_id, {
              operation_date: value.date,
              description: value.description.trim(),
              direction: amountIn ? 'inflow' : 'outflow',
              amount,
              ...chosen,
              idempotency_key: this.idempotencyKey,
            }),
      );
      this.idempotencyKey = crypto.randomUUID();
      this.reset(value.date);
      this.page.set(1);
      this.reload();
      // A line completed in its place: done, the list as it is.
      if (close || reconciling) {
        this.editing.set(false);
      } else {
        setTimeout(() => this.focus('description'));
      }
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.error.set(toUserError(error, TREASURY_ERRORS));
      }
    } finally {
      this.saving.set(false);
    }
  }

  private reload(): void {
    this.balance.reload();
    this.lines.reload();
  }

  private reset(date = localToday()): void {
    this.form.enable({ emitEvent: false });
    this.form.reset({
      date,
      description: '',
      partner: null,
      line: '',
      account: null,
      writeOff: null,
      amountIn: '',
      amountOut: '',
    });
    this.reconciling.set(null);
    this.openLines.set([]);
    this.counterpart.set('choose');
    this.invalid.set(null);
    this.error.set(null);
  }

  private readOpenLines(partner: AutocompleteOption | null): void {
    this.form.controls.line.setValue('', { emitEvent: false });
    this.openLines.set([]);
    if (!partner) {
      return;
    }
    this.lettering
      .lines({ partner: partner.id, status: 'open' })
      .pipe(
        map((found) => found.results),
        catchError(() => of([] as LetterableLine[])),
      )
      .subscribe((found) => this.openLines.set(found));
  }

  /** A line begun and left (an amount typed, not recorded): kept « à rapprocher ». */
  private keepBegunLine(alive = false): void {
    const account = this.account();
    const value = this.form.getRawValue();
    const amountIn = normalizeDecimalInput(value.amountIn.trim());
    const amount = amountIn || normalizeDecimalInput(value.amountOut.trim());
    if (
      !account ||
      !this.canRecord() ||
      !this.editing() ||
      this.saving() ||
      this.reconciling() ||
      !value.date ||
      !amount ||
      Number(amount) <= 0
    ) {
      return;
    }
    this.treasury
      .recordTransaction(account.public_id, {
        operation_date: value.date,
        description: value.description.trim(),
        direction: amountIn ? 'inflow' : 'outflow',
        amount,
        partner: null,
        settled_line: null,
        offset_account: null,
        idempotency_key: this.idempotencyKey,
      })
      .subscribe({
        next: () => {
          this.idempotencyKey = crypto.randomUUID();
          this.toast.info(`Ligne « ${value.description.trim() || amount} » gardée à rapprocher.`);
          if (alive) {
            this.reload();
          }
        },
        error: () => undefined,
      });
  }

  /** An invoice chosen: what remains on it, received or paid; its number as the label. */
  private fillFromLine(id: string): void {
    const line = this.openLines().find((item) => item.public_id === id);
    if (!line || this.reconciling()) {
      return;
    }
    const controls = this.form.controls;
    const amount = trimDecimalZeros(line.open_amount, this.decimals());
    const owedToCompany = line.side === 'debit';
    controls.amountIn.setValue(owedToCompany ? amount : '', { emitEvent: false });
    controls.amountOut.setValue(owedToCompany ? '' : amount, { emitEvent: false });
    if (!controls.description.value.trim()) {
      controls.description.setValue(
        `Règlement ${line.document_reference || line.entry.entry_number}`,
      );
    }
  }

  private rowOf(transaction: TreasuryTransaction): Row {
    const out = transaction.direction === 'outflow';
    const done = transaction.status === 'accounted';
    const money = (value: string) => `${this.money(value)} ${transaction.currency}`;
    const account = transaction.offset_account;
    // Un virement de Trésorerie › Virements : l'autre journal, donné par le serveur.
    const other = transaction.transfer_account;
    const counterpart = other
      ? other.name
      : transaction.settled.length
        ? transaction.settled.join(', ')
        : account
          ? `${account.code} ${account.name}`
          : '';
    return {
      transaction,
      day: formatDate(transaction.operation_date, 'd MMM', this.locale),
      partner: other ? TRANSFER : (transaction.counterparty?.name ?? transaction.counterparty_name),
      label: transaction.description || transaction.reference,
      counterpart: done ? counterpart : 'À rapprocher',
      done,
      // No entry yet (confirmed, or a draft of « Opérations »): « à rapprocher » (note 0050).
      toReconcile: (transaction.status === 'confirmed' || transaction.status === 'draft') && !other,
      inflow: out ? '' : money(transaction.amount),
      outflow: out ? money(transaction.amount) : '',
      running: transaction.running_balance === null ? '' : money(transaction.running_balance),
    };
  }

  /** « Charger » : the import of a statement, when the user may open it. */
  protected readonly importUrl = computed(() => {
    const url = `${TREASURY}/releves/import`;
    return this.navigation.canOpenUrl(url) && this.session.can('treasury.manage_statements')
      ? url
      : null;
  });

  private focus(name: string): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(`[formControlName="${name}"] input, [formControlName="${name}"]`)
      ?.focus();
  }
}
