import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { SessionStore } from '../../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../../shared/forms/autocomplete';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import {
  formatDecimal,
  isZeroDecimal,
  subtractDecimals,
  sumDecimals,
  trimDecimalZeros,
} from '../../../shared/utils/decimal';
import { EntriesApi } from '../data-access/entries-api';
import { LETTERING_PAGE_SIZE, LetteringApi } from '../data-access/lettering-api';
import { LetterableLine, LetteringPreview, PreviewRow } from '../data-access/lettering-models';
import { isoDay } from '../entries/entry-presentation';
import {
  LETTERING_ERRORS,
  LINE_STATUS,
  SIDES,
  STALE_CODES,
  newIdempotencyKey,
} from './lettering-presentation';
import { LetteringScope, scopeKey } from './lettering-scope';

/** The figures of a refused unbalanced selection (`details` of `accounting_lettering_unbalanced`). */
interface Unbalanced {
  readonly debit: string;
  readonly credit: string;
  readonly difference: string;
}

/**
 * The lines to letter (`GET letterable-lines/`), their selection and the manual lettering:
 * select → preview (`POST letterings/preview/`, nothing written) → check → confirm
 * (`POST letterings/`). The selected totals and their difference are a reading aid summed
 * exactly from the open amounts the server gave; the server checks the selection, computes
 * the lettered amount and the residual, and refuses what it must. A partial lettering is
 * asked explicitly (`allow_partial`). After a lettering, or when the server says the screen
 * is stale (a line lettered in between), the lines are read again and the selection
 * dropped: no state is ever simulated here. One idempotency key per previewed request,
 * kept while that request is retried.
 */
@Component({
  selector: 'alco-letterable-lines',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoAutocomplete,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './letterable-lines.html',
  styleUrls: ['../accounting-list.scss', './letterable-lines.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoLetterableLines {
  private readonly api = inject(LetteringApi);
  private readonly entries = inject(EntriesApi);
  private readonly toast = inject(AlcoToastService);
  private readonly injector = inject(Injector);
  private readonly session = inject(SessionStore);

  readonly scope = input.required<LetteringScope>();
  readonly decimals = input<ReadonlyMap<string, number>>(new Map());
  /** Filters are active: an empty list proposes to reset them. */
  readonly filtered = input(false);
  readonly pageChange = output<number>();
  readonly pastEnd = output<void>();
  readonly resetFilters = output<void>();

  protected readonly pageSize = LETTERING_PAGE_SIZE;
  protected readonly entriesUrl = `${APP_ROOT}/comptabilite/ecritures`;
  protected readonly sides = SIDES;
  protected readonly day = isoDay;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'date', label: 'Date', width: '6.5rem' },
    { key: 'entry', label: 'Écriture' },
    { key: 'account', label: 'Compte · tiers' },
    { key: 'label', label: 'Libellé', hideBelow: 'laptop' },
    { key: 'debit', label: 'Débit', numeric: true },
    { key: 'credit', label: 'Crédit', numeric: true },
    { key: 'open', label: 'Ouvert', numeric: true },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (line: LetterableLine) => line.public_id;
  protected readonly rowLabel = (line: LetterableLine) => this.lineName(line);

  protected readonly list = requestState(() => this.load(untracked(this.scope)), {
    immediate: false,
  });
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, LETTERING_ERRORS) : null;
  });

  // ---- Selection (kept across pages of the same list) ------------------------------------
  protected readonly canLetter = computed(() => this.session.can('accounting.letter'));
  /** Only the lines still open are offered (the « à lettrer » view), with the permission. */
  protected readonly selectable = computed(
    () => this.canLetter() && this.scope().lineView === 'open',
  );
  protected readonly selected = signal<ReadonlyMap<string, LetterableLine>>(new Map());
  protected readonly selection = computed<ReadonlySet<string>>(
    () => new Set(this.selected().keys()),
  );
  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly allowPartial = signal(false);
  private readonly selectedLines = computed(() => [...this.selected().values()]);
  /** Reading aid: the open amounts selected on each side and their difference, exact. */
  protected readonly debitTotal = computed(() => this.openTotal('debit'));
  protected readonly creditTotal = computed(() => this.openTotal('credit'));
  protected readonly difference = computed(() =>
    subtractDecimals(this.debitTotal(), this.creditTotal()),
  );
  protected readonly currency = computed(() => this.selectedLines()[0]?.currency ?? '');
  protected readonly summary = computed(() => {
    const count = this.selectedCount();
    if (count === 0) {
      return 'Aucune ligne sélectionnée.';
    }
    const currency = this.currency();
    return (
      `${count} ${count > 1 ? 'lignes sélectionnées' : 'ligne sélectionnée'}. ` +
      `Ouvert au débit ${this.money(this.debitTotal(), currency)}, ` +
      `au crédit ${this.money(this.creditTotal(), currency)}, ` +
      `écart ${this.money(this.difference(), currency)}.`
    );
  });

  // ---- Preview and lettering ----------------------------------------------------------
  protected readonly preview = signal<LetteringPreview | null>(null);
  protected readonly previewing = signal(false);
  protected readonly lettering = signal(false);
  protected readonly previewError = signal<UserError | null>(null);
  protected readonly unbalanced = signal<Unbalanced | null>(null);
  /** An error of the last command, after which the lines were read again. */
  protected readonly staleError = signal<UserError | null>(null);
  /** Where an unbalanced selection's difference goes (note backend 0065), as typed. */
  protected readonly writeOffField = new FormControl<AutocompleteOption | null>(null);
  protected readonly writeOffChoice = toSignal(this.writeOffField.valueChanges, {
    initialValue: null,
  });
  /** The account the shown preview was asked with: its difference settled there. */
  protected readonly writeOff = signal<AutocompleteOption | null>(null);
  /** The difference of the shown preview, as the server gave its totals (no sign). */
  protected readonly previewGap = computed(() => {
    const result = this.preview();
    return result
      ? subtractDecimals(result.debit_total, result.credit_total).replace(/^-/, '')
      : '0';
  });
  protected readonly searchAccounts: AutocompleteSearch = (term) =>
    this.entries
      .postableAccounts(term)
      .pipe(
        map((found) =>
          found.map((account) => ({
            id: account.public_id,
            label: account.code,
            detail: account.name,
          })),
        ),
      );
  private idempotencyKey: string | null = null;
  private readonly previewTitle = viewChild<ElementRef<HTMLElement>>('previewTitle');
  private lastScope = '';

  constructor() {
    effect(() => {
      const scope = this.scope();
      untracked(() => {
        const key = scopeKey(scope);
        if (key !== this.lastScope) {
          // Another list: the selection of the previous one means nothing here.
          this.lastScope = key;
          this.clearSelection();
          this.staleError.set(null);
        }
        this.list.reload();
      });
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.scope).page > 1) {
        untracked(() => this.pastEnd.emit());
      }
    });
  }

  protected lineName(line: LetterableLine): string {
    return `${line.entry.entry_number} ${line.label || line.document_reference}`.trim();
  }

  protected statusLook(line: LetterableLine) {
    return LINE_STATUS[line.status];
  }

  protected decimalsOf(currency: string): number {
    return this.decimals().get(currency) ?? 0;
  }

  protected isSelected(line: LetterableLine): boolean {
    return this.selected().has(line.public_id);
  }

  /** The table's selection (this page's lines): lines of other pages stay selected. */
  protected onTableSelection(ids: ReadonlySet<string>): void {
    const next = new Map(this.selected());
    for (const line of this.rows()) {
      if (ids.has(line.public_id)) {
        next.set(line.public_id, line);
      } else {
        next.delete(line.public_id);
      }
    }
    this.select(next);
  }

  protected toggle(line: LetterableLine): void {
    const next = new Map(this.selected());
    if (next.has(line.public_id)) {
      next.delete(line.public_id);
    } else {
      next.set(line.public_id, line);
    }
    this.select(next);
  }

  protected clearSelection(): void {
    this.select(new Map());
  }

  protected setAllowPartial(value: boolean): void {
    this.allowPartial.set(value);
    this.clearWriteOff();
    this.discardPreview();
  }

  protected onPartialChange(event: Event): void {
    this.setAllowPartial((event.target as HTMLInputElement).checked);
  }

  /** A residual the server says stays open on this line. */
  protected hasResidual(row: PreviewRow): boolean {
    return !isZeroDecimal(row.residual);
  }

  protected setPage(page: number): void {
    this.pageChange.emit(page);
  }

  /** Asks the server what the lettering would do; nothing is written. */
  protected async showPreview(): Promise<void> {
    if (this.previewing() || this.lettering() || this.selectedCount() === 0) {
      return;
    }
    this.previewing.set(true);
    this.discardPreview();
    this.staleError.set(null);
    try {
      const preview = await firstValueFrom(
        this.api.preview({
          lines: [...this.selected().keys()],
          allow_partial: this.allowPartial(),
          ...this.writeOffRequest(),
        }),
      );
      this.preview.set(preview);
      // One key for this request, kept if its confirmation has to be sent again.
      this.idempotencyKey = newIdempotencyKey();
    } catch (failure) {
      this.refused(toApiError(failure), 'preview');
    } finally {
      this.previewing.set(false);
    }
    afterNextRender(() => this.previewTitle()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  /** The unbalanced selection, previewed again as a partial lettering (asked by the user). */
  protected previewPartial(): void {
    this.clearWriteOff();
    this.allowPartial.set(true);
    void this.showPreview();
  }

  /** The difference settled on the account chosen: every line lettered in full. */
  protected previewWriteOff(): void {
    const account = this.writeOffField.value;
    if (!account) {
      return;
    }
    this.allowPartial.set(false);
    this.writeOff.set(account);
    void this.showPreview();
  }

  /** Letters the previewed lines (`POST letterings/`), once: the button waits for the answer. */
  protected async confirm(): Promise<void> {
    const preview = this.preview();
    if (!preview || this.lettering()) {
      return;
    }
    this.lettering.set(true);
    this.previewError.set(null);
    this.idempotencyKey ??= newIdempotencyKey();
    try {
      const created = await firstValueFrom(
        this.api.letter({
          lines: [...this.selected().keys()],
          allow_partial: this.allowPartial(),
          ...this.writeOffRequest(),
          idempotency_key: this.idempotencyKey,
        }),
      );
      const account = this.writeOff();
      this.toast.success(
        account
          ? `Lettrage ${created.reference} créé. L’écart est passé sur le compte ${account.label}.`
          : created.partial
            ? `Lettrage ${created.reference} créé. Le résiduel reste ouvert.`
            : `Lettrage ${created.reference} créé.`,
      );
      this.afterCommand();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.code === 'accounting_lettering_exists') {
        // The same request already succeeded (its answer was lost): nothing more was made.
        this.toast.info('Ce lettrage était déjà enregistré : rien n’a été créé une seconde fois.');
        this.afterCommand();
      } else {
        this.refused(error, 'confirm');
      }
    } finally {
      this.lettering.set(false);
    }
  }

  protected closePreview(): void {
    this.clearWriteOff();
    this.discardPreview();
  }

  private select(next: ReadonlyMap<string, LetterableLine>): void {
    this.selected.set(next);
    this.clearWriteOff();
    this.discardPreview();
  }

  /** `write_off_account` only when an account was chosen. */
  private writeOffRequest(): { write_off_account?: string } {
    const account = this.writeOff();
    return account ? { write_off_account: account.id } : {};
  }

  private clearWriteOff(): void {
    this.writeOff.set(null);
    this.writeOffField.setValue(null);
  }

  private discardPreview(): void {
    this.preview.set(null);
    this.previewError.set(null);
    this.unbalanced.set(null);
    this.idempotencyKey = null;
  }

  /** After a lettering: the server's lines again, nothing selected. */
  private afterCommand(): void {
    this.allowPartial.set(false);
    this.clearSelection();
    this.list.reload();
  }

  private refused(error: ApiError, step: 'preview' | 'confirm'): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const message = toUserError(error, LETTERING_ERRORS);
    if (error.code && STALE_CODES.has(error.code)) {
      // What the screen shows is no longer true: read again, never keep a stale selection.
      this.staleError.set(message);
      this.afterCommand();
      return;
    }
    this.previewError.set(message);
    if (error.code === 'accounting_lettering_unbalanced') {
      this.unbalanced.set(this.unbalancedFigures(error.details));
    }
    if (step === 'preview') {
      this.preview.set(null);
    }
  }

  private unbalancedFigures(details: unknown): Unbalanced | null {
    const value = details as Partial<Record<keyof Unbalanced, unknown>> | null;
    return value &&
      typeof value.debit === 'string' &&
      typeof value.credit === 'string' &&
      typeof value.difference === 'string'
      ? { debit: value.debit, credit: value.credit, difference: value.difference }
      : null;
  }

  private openTotal(side: 'debit' | 'credit'): string {
    return sumDecimals(
      this.selectedLines()
        .filter((line) => line.side === side)
        .map((line) => line.open_amount),
    );
  }

  private money(value: string, currency: string): string {
    const decimals = this.decimalsOf(currency);
    return `${formatDecimal(trimDecimalZeros(value, decimals), decimals)} ${currency}`.trim();
  }

  private load(scope: LetteringScope) {
    return this.api.lines({
      account: scope.account,
      partner: scope.partner,
      status: scope.lineView === 'all' ? null : scope.lineView,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      page: scope.page,
    });
  }
}
