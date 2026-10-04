import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SessionStore } from '../../../core/session/session.store';
import { openTestSession } from '../../../core/session/testing';
import { AlcoTransferActions } from './transfer-actions';
import { TRANSFER_KINDS, TransferKindId } from './transfer-kinds';

@Component({
  imports: [AlcoTransferActions],
  template: `<alco-transfer-actions [kind]="kind()" />`,
})
class Host {
  readonly kind = signal<TransferKindId>('assets');
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
    openTestSession(TestBed.inject(SessionStore), { permissions, features: [] });
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

  const ALL = ['imports_exports.create', 'imports_exports.export', 'assets.read', 'reporting.read'];

  it('names exactly the operation of the domain (fixed assets)', async () => {
    expect((await items('assets', ALL)).map((item) => item.label)).toEqual([
      'Importer des immobilisations',
      'Exporter les immobilisations',
    ]);
  });

  it('names exactly the operation of the domain (balance: an export only)', async () => {
    expect((await items('balance', ALL)).map((item) => item.label)).toEqual([
      'Exporter la balance',
    ]);
  });

  it('shows the future operations of a domain disabled (fixed assets)', async () => {
    expect((await items('assets', ALL)).every((item) => item.disabled)).toBe(true);
  });

  it('shows no menu when the user may perform none of them', async () => {
    expect(await items('assets', ['assets.read'])).toEqual([]);
  });

  it('hides only the operations the user may not perform', async () => {
    const labels = (await items('assets', ['imports_exports.export', 'assets.read'])).map(
      (item) => item.label,
    );
    expect(labels).toEqual(['Exporter les immobilisations']);
  });

  it('the planned domains: only the reporting exports exist in the API V1', () => {
    const imports = Object.values(TRANSFER_KINDS)
      .map((kind) => kind.importType)
      .filter(Boolean);
    const exports = Object.values(TRANSFER_KINDS)
      .map((kind) => kind.exportType)
      .filter(Boolean);
    expect(imports).toEqual([]);
    expect(exports.sort()).toEqual(['reporting.balance', 'reporting.ledger']);
  });
});
