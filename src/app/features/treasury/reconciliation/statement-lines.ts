import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { toUserError } from '../../../core/errors/user-error';
import { requestState } from '../../../core/http/request-state';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPagination } from '../../../shared/ui/pagination/pagination';
import { isoDay } from '../../accounting/entries/entry-presentation';
import { StatementLine } from '../data-access/reconciliation-models';
import { RECONCILIATION_PAGE_SIZE, TreasuryApi } from '../data-access/treasury-api';
import { AlcoLinePanel, LineChange } from './line-panel';
import {
  DIRECTIONS,
  LINE_STATUS,
  RECONCILIATION_ERRORS,
  VIEW_STATUS,
} from './reconciliation-presentation';
import { ReconciliationScope } from './reconciliation-scope';

/** The empty state of each view of lines. */
const EMPTY: Readonly<Record<string, { title: string; message: string }>> = {
  unreconciled: {
    title: 'Aucune ligne à rapprocher.',
    message: 'Toutes les lignes de relevé de ce compte sont rapprochées ou exclues.',
  },
  reconciled: {
    title: 'Aucune ligne rapprochée.',
    message: 'Les lignes rapprochées s’afficheront ici, avec leur rapprochement.',
  },
  excluded: {
    title: 'Aucune ligne exclue.',
    message: 'Une ligne mise de côté du rapprochement, avec son motif, s’afficherait ici.',
  },
};

/**
 * The bank lines of the account in one state (`GET statement-lines/?account&statement&status`),
 * as the server lists them, and the record of the line the user opens (`AlcoLinePanel`): its
 * fields, its reconciliations and their cancellation. Nothing is filtered or computed here;
 * after a cancellation the list is read again.
 */
@Component({
  selector: 'alco-statement-lines',
  imports: [
    AlcoAmountPipe,
    AlcoBadge,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLinePanel,
    AlcoLoading,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './statement-lines.html',
  styleUrls: ['../../accounting/accounting-list.scss', './statement-lines.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoStatementLines {
  private readonly api = inject(TreasuryApi);
  private readonly injector = inject(Injector);

  readonly scope = input.required<ReconciliationScope>();
  readonly decimals = input<ReadonlyMap<string, number>>(new Map());
  readonly pageChange = output<number>();
  readonly pastEnd = output<void>();
  readonly showProposals = output<void>();

  protected readonly pageSize = RECONCILIATION_PAGE_SIZE;
  protected readonly day = isoDay;
  protected readonly columns: readonly TableColumn[] = [
    { key: 'date', label: 'Date', width: '6.5rem' },
    { key: 'description', label: 'Libellé' },
    { key: 'reference', label: 'Référence', hideBelow: 'laptop' },
    { key: 'direction', label: 'Sens', width: '5.5rem', hideBelow: 'tablet' },
    { key: 'amount', label: 'Montant', numeric: true },
    { key: 'status', label: 'État', width: '9rem', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (line: StatementLine) => line.public_id;

  protected readonly status = computed(
    () => VIEW_STATUS[this.scope().view as keyof typeof VIEW_STATUS] ?? 'unreconciled',
  );
  protected readonly list = requestState(
    () => {
      const scope = untracked(this.scope);
      return this.api.lines({
        account: scope.account,
        statement: scope.statement,
        status: untracked(this.status),
        page: scope.page,
      });
    },
    { immediate: false },
  );
  protected readonly rows = computed(() => this.list.value()?.results ?? []);
  protected readonly failure = computed(() => {
    const error = this.list.error();
    return error ? toUserError(error, RECONCILIATION_ERRORS) : null;
  });
  protected readonly empty = computed(() => EMPTY[this.status()]);

  /** The line opened (from the list the server gave). */
  protected readonly selected = signal<StatementLine | null>(null);
  /** What the last command did, said until another line is opened. */
  protected readonly notice = signal<string | null>(null);
  private readonly panelTitle = viewChild<ElementRef<HTMLElement>>('panelAnchor');

  constructor() {
    effect(() => {
      this.scope();
      untracked(() => {
        this.selected.set(null);
        this.list.reload();
      });
    });
    effect(() => {
      if (this.list.error()?.kind === 'not-found' && untracked(this.scope).page > 1) {
        untracked(() => this.pastEnd.emit());
      }
    });
  }

  protected decimalsOf(): number {
    return this.decimals().get(this.scope().currency) ?? 0;
  }

  protected directionOf(line: StatementLine): string {
    return DIRECTIONS[line.direction];
  }

  protected statusOf(line: StatementLine) {
    return LINE_STATUS[line.status];
  }

  protected open(line: StatementLine): void {
    this.notice.set(null);
    this.selected.set(line);
    afterNextRender(() => this.panelTitle()?.nativeElement.focus(), { injector: this.injector });
  }

  protected close(): void {
    this.selected.set(null);
  }

  /** A command changed the line: the list as the server now has it. */
  protected changed(change: LineChange): void {
    this.selected.set(null);
    this.notice.set(change.message);
    this.list.reload();
  }

  protected setPage(page: number): void {
    this.pageChange.emit(page);
  }

  protected lineName(line: StatementLine): string {
    return `${isoDay(line.line_date)} ${line.description || line.bank_reference || 'sans libellé'}`;
  }
}
