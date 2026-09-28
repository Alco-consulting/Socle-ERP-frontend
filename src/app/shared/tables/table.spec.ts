import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AlcoCell, AlcoTable, TableColumn, TableGroup, TableSort } from './table';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly amount: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', amount: '10' },
  { id: 'b', name: 'Beta', amount: '20' },
];

@Component({
  imports: [AlcoTable, AlcoCell],
  template: `
    <alco-table
      caption="Test"
      [columns]="columns"
      [rows]="rows"
      [groups]="groups()"
      [rowId]="rowId"
      [(sort)]="sort"
      [selectable]="true"
      [(selection)]="selection"
      [totals]="{ amount: '30' }"
    >
      <ng-template alcoCell="name" let-row
        ><strong>{{ row.name }}</strong></ng-template
      >
    </alco-table>
  `,
})
class Host {
  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nom', sortable: true },
    { key: 'amount', label: 'Montant', numeric: true },
  ];
  readonly rows = ROWS;
  readonly rowId = (row: Row) => row.id;
  readonly sort = signal<TableSort | null>(null);
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly groups = signal<TableGroup<Row>[] | null>(null);
}

describe('AlcoTable', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, element, host: fixture.componentInstance };
  }

  it('renders custom cells, numeric alignment and a distinct totals row', async () => {
    const { element } = await setup();
    expect(element.querySelector('tbody strong')?.textContent).toBe('Alpha');
    expect(element.querySelector('tbody td.num')?.textContent?.trim()).toBe('10');
    expect(element.querySelector('tfoot')?.textContent).toContain('30');
  });

  it('requests a sort and exposes it through aria-sort', async () => {
    const { fixture, element, host } = await setup();
    const header = element.querySelector('th[aria-sort]') as HTMLElement;
    expect(header.getAttribute('aria-sort')).toBe('none');
    (header.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.sort()).toEqual({ key: 'name', direction: 'asc' });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    (header.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.sort()?.direction).toBe('desc');
  });

  it('selects all visible rows, then none', async () => {
    const { fixture, element, host } = await setup();
    const all = element.querySelector('thead input[type=checkbox]') as HTMLInputElement;
    all.click();
    await fixture.whenStable();
    expect([...host.selection()]).toEqual(['a', 'b']);
    all.click();
    await fixture.whenStable();
    expect(host.selection().size).toBe(0);
  });

  it('shows group headers with counts and collapses a group', async () => {
    const { fixture, element, host } = await setup();
    host.groups.set([{ key: 'g', label: 'Groupe A', rows: ROWS }]);
    await fixture.whenStable();
    const toggle = element.querySelector('.group-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Groupe A');
    expect(toggle.textContent).toContain('(2)');
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('scrolls in its own keyboard-reachable frame', async () => {
    const { element } = await setup();
    const frame = element.querySelector('.scroll') as HTMLElement;
    expect(frame.getAttribute('tabindex')).toBe('0');
    expect(frame.getAttribute('role')).toBe('region');
  });
});
