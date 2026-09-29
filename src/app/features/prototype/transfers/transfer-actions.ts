import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { SessionStore } from '../../../core/session/session.store';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { TRANSFER_KINDS, TransferKindId, UNAVAILABLE_REASON } from './transfer-kinds';

/**
 * PROTOTYPE — « Actions ▾ » of a domain screen with its own import and export, exactly for
 * that domain (« Importer des écritures » on the entries, « Exporter les tiers » on the
 * partners). Hidden without the permissions; disabled with the reason when the API does
 * not offer the operation. Nothing is sent: the export only asks for confirmation.
 */
@Component({
  selector: 'alco-transfer-actions',
  imports: [AlcoDropdown],
  template: `
    @if (items().length > 0) {
      <alco-dropdown align="end" [items]="items()" (selected)="onSelected($event)">
        Actions
      </alco-dropdown>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoTransferActions {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);

  readonly kind = input.required<TransferKindId>();
  /** Number of records the export would contain (the current list). */
  readonly count = input<number | null>(null);
  /** Import page, relative to the current screen. */
  readonly importPath = input('import');

  protected readonly items = computed<readonly DropdownItem[]>(() => {
    const kind = TRANSFER_KINDS[this.kind()];
    const items: DropdownItem[] = [];
    if (
      kind.importLabel &&
      this.session.can('imports_exports.create') &&
      this.session.can(kind.importPermission)
    ) {
      items.push({
        id: 'import',
        label: kind.importLabel,
        icon: 'upload',
        disabled: !kind.importType,
        description: kind.importType ? undefined : UNAVAILABLE_REASON,
      });
    }
    if (
      kind.exportLabel &&
      this.session.can('imports_exports.export') &&
      this.session.can(kind.exportPermission)
    ) {
      items.push({
        id: 'export',
        label: kind.exportLabel,
        icon: 'download',
        disabled: !kind.exportType,
        description: kind.exportType ? undefined : UNAVAILABLE_REASON,
      });
    }
    return items;
  });

  protected async onSelected(item: DropdownItem): Promise<void> {
    if (item.id === 'import') {
      await this.router.navigate([this.importPath()], { relativeTo: this.route });
      return;
    }
    const kind = TRANSFER_KINDS[this.kind()];
    const count = this.count();
    const confirmed = await this.confirm.confirm({
      title: `${kind.exportLabel} ?`,
      message:
        (count !== null
          ? `Le fichier CSV contiendra ${count} ligne${count > 1 ? 's' : ''}. `
          : '') +
        'Il est préparé par le serveur, reste privé et expire après un délai fixé par le serveur.',
      confirmLabel: kind.exportLabel,
    });
    if (confirmed) {
      this.toast.success('Export en préparation. Prototype : aucun fichier n’est créé.');
    }
  }
}
