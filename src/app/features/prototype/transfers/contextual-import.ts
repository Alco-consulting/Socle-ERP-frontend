import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoCard } from '../../../shared/ui/card/card';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps } from '../../../shared/ui/workflow-steps/workflow-steps';
import { TRANSFER_KINDS, TransferKindId } from './transfer-kinds';

/** Steps of an import run in the API (`created → uploaded → … → completed`). */
const STEPS = [
  { id: 'file', label: 'Fichier' },
  { id: 'mapping', label: 'Correspondance des colonnes' },
  { id: 'checks', label: 'Contrôles' },
  { id: 'preview', label: 'Aperçu' },
  { id: 'import', label: 'Import' },
];

/**
 * PROTOTYPE — import screen reached FROM its domain (Écritures › Actions › Importer des
 * écritures): the title and the columns are those of that domain only. First step only;
 * the file is neither read nor sent.
 */
@Component({
  selector: 'alco-contextual-import',
  imports: [RouterLink, AlcoButton, AlcoCard, AlcoIcon, AlcoPageHeader, AlcoWorkflowSteps],
  templateUrl: './contextual-import.html',
  styleUrl: './contextual-import.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextualImportPage {
  private readonly toast = inject(AlcoToastService);

  private readonly kindId = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => data['transferKind'] as TransferKindId)),
    { requireSync: true },
  );
  protected readonly kind = computed(() => TRANSFER_KINDS[this.kindId()]);
  protected readonly steps = STEPS;
  protected readonly fileName = signal('');

  protected onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.fileName.set(file?.name ?? '');
  }

  protected continue(): void {
    this.toast.info(
      'Prototype : le fichier n’est ni lu ni envoyé. Les étapes suivantes viendront avec l’API.',
    );
  }
}
