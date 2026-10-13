import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { localToday } from '../../../shared/utils/dates';
import {
  formatDecimal,
  normalizeDecimalInput,
  trimDecimalZeros,
} from '../../../shared/utils/decimal';
import { EntriesApi } from '../../accounting/data-access/entries-api';
import { LetterableLine } from '../../accounting/data-access/lettering-models';
import { LetteringApi } from '../../accounting/data-access/lettering-api';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TreasuryAccount, TreasuryTransaction } from '../data-access/reconciliation-models';
import { TREASURY_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import { TREASURY_ERRORS } from '../treasury-presentation';

const TREASURY = `${APP_ROOT}/comptabilite/tresorerie`;

/** A row of the list, in Odoo's words: the date, the partner and label, what it settled. */
interface Row {
  readonly transaction: TreasuryTransaction;
  readonly day: string;
  readonly partner: string;
  readonly label: string;
  readonly counterpart: string;
  readonly done: boolean;
  readonly amount: string;
  readonly out: boolean;
}

/**
 * Odoo's « Réconciliation bancaire » of a bank or cash journal (note backend 0044): its
 * balance, a line typed at the top (date, label, partner and one of its unpaid invoices, or
 * the counterpart account; the money in or out), then the journal's lines. A line is
 * recorded, posted and lettered by the server at once: no lettering to do afterwards.
 */
@Component({
  selector: 'alco-transactions-page',
  imports: [
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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
    account: new FormControl<AutocompleteOption | null>(null),
    amountIn: new FormControl('', { nonNullable: true }),
    amountOut: new FormControl('', { nonNullable: true }),
  });
  private readonly value = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    {
      initialValue: this.form.getRawValue(),
    },
  );
  /** The partner's unpaid invoices (its open lines), read when the partner is chosen. */
  protected readonly openLines = signal<readonly LetterableLine[]>([]);
  protected readonly hasPartner = computed(() => this.value().partner !== null);
  protected readonly needsAccount = computed(() => this.value().line === '');

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
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.entries.postableAccounts(term).pipe(
      map((found) =>
        found.map((account) => ({
          id: account.public_id,
          label: account.code,
          detail: account.name,
        })),
      ),
    );

  constructor() {
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
    return `${name} · ${day} · reste ${this.money(line.open_amount)} ${line.currency}`;
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

  protected ignore(): void {
    this.reset();
    this.editing.set(false);
  }

  /** « Ajouter & Nouveau » (`close` false) or « Ajouter & Fermer ». */
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
    if (!value.line && !value.account) {
      this.invalid.set(
        value.partner
          ? 'Choisissez une facture du partenaire, ou le compte de contrepartie.'
          : 'Choisissez un partenaire et sa facture, ou le compte de contrepartie.',
      );
      return;
    }
    this.invalid.set(null);
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.treasury.recordTransaction(account.public_id, {
          operation_date: value.date,
          description: value.description.trim(),
          direction: amountIn ? 'inflow' : 'outflow',
          amount,
          partner: value.partner?.id ?? null,
          settled_line: value.line || null,
          offset_account: value.line ? null : (value.account?.id ?? null),
          idempotency_key: this.idempotencyKey,
        }),
      );
      this.idempotencyKey = crypto.randomUUID();
      this.reset(value.date);
      this.page.set(1);
      this.reload();
      if (close) {
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
    this.form.reset({
      date,
      description: '',
      partner: null,
      line: '',
      account: null,
      amountIn: '',
      amountOut: '',
    });
    this.openLines.set([]);
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

  /** An invoice chosen: what remains on it, received or paid; its number as the label. */
  private fillFromLine(id: string): void {
    const line = this.openLines().find((item) => item.public_id === id);
    if (!line) {
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
    const account = transaction.offset_account;
    const counterpart = transaction.settled.length
      ? transaction.settled.join(', ')
      : account
        ? `${account.code} ${account.name}`
        : '';
    return {
      transaction,
      day: formatDate(transaction.operation_date, 'd MMM', this.locale),
      partner: transaction.counterparty?.name ?? transaction.counterparty_name,
      label: transaction.description || transaction.reference,
      counterpart: done ? counterpart : 'À comptabiliser',
      done,
      amount: `${out ? '-' : ''}${this.money(transaction.amount)} ${transaction.currency}`,
      out,
    };
  }

  /** « Charger » : the import of a statement, when the user may open it. */
  protected readonly importUrl = computed(() => {
    const url = `${TREASURY}/releves/import`;
    return this.navigation.canOpenUrl(url) && this.session.can('treasury.manage_statements')
      ? url
      : null;
  });

  protected chooseAccount(code: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { compte: code },
      replaceUrl: true,
    });
  }

  private focus(name: string): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(`[formControlName="${name}"] input, [formControlName="${name}"]`)
      ?.focus();
  }
}
