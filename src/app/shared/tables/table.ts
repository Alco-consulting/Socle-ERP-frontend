import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';

import { AlcoIcon } from '../ui/icon/icon';

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  /** Amounts and quantities: right aligned, tabular figures. */
  readonly numeric?: boolean;
  readonly sortable?: boolean;
  /** Secondary column hidden on narrow screens. */
  readonly hideBelow?: 'tablet' | 'laptop';
  readonly width?: string;
}

export interface TableSort {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

/** Rows already grouped by the page or the server (the table never computes groups). */
export interface TableGroup<T> {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly T[];
}

/** Custom rendering of one column: `<ng-template alcoCell="number" let-row>…</ng-template>`. */
@Directive({ selector: 'ng-template[alcoCell]' })
export class AlcoCell {
  readonly key = input.required<string>({ alias: 'alcoCell' });
  readonly template = inject<TemplateRef<{ $implicit: unknown }>>(TemplateRef);
}

/**
 * Data table of the design system. Presentational only: sorting, paging and grouping are
 * requested through outputs and performed by the page (server side for real data).
 * - Useful columns only; secondary ones use `hideBelow`.
 * - Selection by checkbox; the page shows bulk actions when the selection is not empty.
 * - `totals` renders a distinct footer row (amounts come already formatted).
 * - Scrolls horizontally inside its own frame on small screens (keyboard reachable).
 */
@Component({
  selector: 'alco-table',
  imports: [NgTemplateOutlet, AlcoIcon],
  templateUrl: './table.html',
  styleUrl: './table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoTable<T> {
  readonly columns = input.required<readonly TableColumn[]>();
  readonly rows = input<readonly T[]>([]);
  readonly groups = input<readonly TableGroup<T>[] | null>(null);
  /** Stable identifier of a row (public id from the API). */
  readonly rowId = input.required<(row: T) => string>();
  /** Accessible name of a row for its checkbox (« Sélectionner EC-2026-000145 »). */
  readonly rowLabel = input<(row: T) => string>((row) => this.rowId()(row));
  /** Accessible description of the table. */
  readonly caption = input.required<string>();
  readonly sort = model<TableSort | null>(null);
  readonly selectable = input(false);
  readonly selection = model<ReadonlySet<string>>(new Set());
  readonly totals = input<Readonly<Record<string, string>> | null>(null);
  readonly totalsLabel = input('Total');
  readonly clickableRows = input(false);

  readonly rowActivated = output<T>();

  private readonly cells = contentChildren(AlcoCell);
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected readonly cellTemplates = computed(() => {
    const map = new Map<string, TemplateRef<{ $implicit: unknown }>>();
    for (const cell of this.cells()) {
      map.set(cell.key(), cell.template);
    }
    return map;
  });

  protected readonly sections = computed<readonly TableGroup<T>[]>(
    () => this.groups() ?? [{ key: '', label: '', rows: this.rows() }],
  );
  protected readonly isGrouped = computed(() => this.groups() !== null);
  protected readonly visibleRows = computed(() => this.sections().flatMap((group) => group.rows));
  protected readonly columnCount = computed(
    () => this.columns().length + (this.selectable() ? 1 : 0),
  );

  protected readonly allSelected = computed(() => {
    const rows = this.visibleRows();
    const selection = this.selection();
    return rows.length > 0 && rows.every((row) => selection.has(this.rowId()(row)));
  });
  protected readonly someSelected = computed(
    () => this.selection().size > 0 && !this.allSelected(),
  );

  protected cellValue(row: T, key: string): unknown {
    return (row as Record<string, unknown>)[key];
  }

  protected ariaSort(column: TableColumn): 'ascending' | 'descending' | 'none' | null {
    if (!column.sortable) {
      return null;
    }
    const sort = this.sort();
    if (sort?.key !== column.key) {
      return 'none';
    }
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected toggleSort(column: TableColumn): void {
    const current = this.sort();
    const direction = current?.key === column.key && current.direction === 'asc' ? 'desc' : 'asc';
    this.sort.set({ key: column.key, direction });
  }

  protected isSelected(row: T): boolean {
    return this.selection().has(this.rowId()(row));
  }

  protected toggleRow(row: T): void {
    const id = this.rowId()(row);
    const next = new Set(this.selection());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selection.set(next);
  }

  protected toggleAll(): void {
    this.selection.set(
      this.allSelected() ? new Set() : new Set(this.visibleRows().map((row) => this.rowId()(row))),
    );
  }

  protected toggleGroup(key: string): void {
    const next = new Set(this.collapsed());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.collapsed.set(next);
  }

  protected onRowClick(event: MouseEvent, row: T): void {
    // Clicks on the checkbox, a link or a button keep their own behaviour.
    const target = event.target as HTMLElement;
    if (this.clickableRows() && !target.closest('a, button, input, label')) {
      this.rowActivated.emit(row);
    }
  }
}
