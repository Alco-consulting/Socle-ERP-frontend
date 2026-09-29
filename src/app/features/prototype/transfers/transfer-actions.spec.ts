import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SessionStore } from '../../../core/session/session.store';
import { AlcoTransferActions } from './transfer-actions';
import { TRANSFER_KINDS, TransferKindId } from './transfer-kinds';

@Component({
  imports: [AlcoTransferActions],
  template: `<alco-transfer-actions [kind]="kind()" />`,
})
class Host {
  readonly kind = signal<TransferKindId>('entries');
}

describe('AlcoTransferActions (contextual import / export)', () => {
  interface MenuItem {
    readonly label: string;
    readonly disabled: boolean;
    readonly description: string;
  }

  /** Opens « Actions ▾ » and reads its entries (empty when the menu is not rendered). */
  async function items(kind: TransferKindId, permissions: string[]): Promise<MenuItem[]> {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(SessionStore).load({
      user: { displayName: 'Test', email: 'test@example.org' },
      companies: [
        { id: 'c', name: 'C', fiscalYearLabel: '2026', currency: 'GNF', permissions, features: [] },
      ],
      activeCompanyId: 'c',
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.kind.set(kind);
    await fixture.whenStable();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector('button');
    if (!trigger) {
      return [];
    }
    trigger.click();
    await fixture.whenStable();
    const entries = Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'));
    const result = entries.map((entry) => ({
      label: entry.querySelector('.menu-text')?.childNodes[0]?.textContent?.trim() ?? '',
      disabled: entry.getAttribute('aria-disabled') === 'true',
      description: entry.querySelector('.menu-description')?.textContent?.trim() ?? '',
    }));
    fixture.destroy();
    return result;
  }

  const ALL = [
    'imports_exports.create',
    'imports_exports.export',
    'accounting.create',
    'accounting.read',
    'partners.create',
    'partners.read',
    'assets.read',
  ];

  it('names exactly the operation of the domain (entries)', async () => {
    expect((await items('entries', ALL)).map((item) => item.label)).toEqual([
      'Importer des écritures',
      'Exporter les écritures',
    ]);
  });

  it('names exactly the operation of the domain (partners)', async () => {
    expect((await items('partners', ALL)).map((item) => item.label)).toEqual([
      'Importer des tiers',
      'Exporter les tiers',
    ]);
  });

  it('offers only what the API does, the rest disabled with the reason', async () => {
    const [entriesImport, entriesExport] = await items('entries', ALL);
    expect(entriesImport.disabled).toBe(false);
    expect(entriesExport.disabled).toBe(true);
    expect(entriesExport.description).toBe('Pas encore proposé par l’API (V1)');
  });

  it('shows the future operations of a domain disabled (fixed assets)', async () => {
    expect((await items('assets', ALL)).every((item) => item.disabled)).toBe(true);
  });

  it('shows no menu when the user may perform none of them', async () => {
    expect(await items('partners', ['partners.read'])).toEqual([]);
  });

  it('hides only the operations the user may not perform', async () => {
    const labels = (await items('partners', ['imports_exports.export', 'partners.read'])).map(
      (item) => item.label,
    );
    expect(labels).toEqual(['Exporter les tiers']);
  });

  it('mirrors the API V1 types exactly', () => {
    const imports = Object.values(TRANSFER_KINDS)
      .map((kind) => kind.importType)
      .filter(Boolean);
    const exports = Object.values(TRANSFER_KINDS)
      .map((kind) => kind.exportType)
      .filter(Boolean);
    expect(imports.sort()).toEqual(['accounting.entries', 'partners']);
    expect(exports.sort()).toEqual(['partners', 'reporting.balance', 'reporting.ledger']);
  });
});
