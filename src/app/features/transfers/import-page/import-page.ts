import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoCard } from '../../../shared/ui/card/card';
import { AlcoConfirmService } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps } from '../../../shared/ui/workflow-steps/workflow-steps';
import { ContextualTransfer, fieldLabel } from '../contextual-transfer';
import { TRANSFER_ERRORS, rowMessage } from '../transfer-messages';
import {
  DELIMITERS,
  ENCODINGS,
  ImportFieldDto,
  ImportMessageDto,
  ImportRowDto,
  ImportRunDto,
  TransfersApi,
} from '../transfers-api';

type Phase = 'file' | 'mapping' | 'checks' | 'preview' | 'done';

const STEPS = [
  { id: 'file', label: 'Fichier' },
  { id: 'mapping', label: 'Correspondance des colonnes' },
  { id: 'checks', label: 'Contrôles' },
  { id: 'preview', label: 'Aperçu' },
  { id: 'done', label: 'Import' },
];

/** Same words, whatever their case or accents: « Raison sociale » ~ « raison_sociale ». */
function comparable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Import reached FROM its domain (Tiers › Actions ▾ › Importer des tiers), on the real API:
 * every step is a server command (`upload`, `parse`, `map`, `validate`, `preview`,
 * `execute`); nothing is written before the last one, and a file with a refused line is
 * imported by no one (all or nothing, decided by the server). The domain is given by the
 * route (`data.transfer`). Each step needs its own permission (`imports_exports.create`,
 * `.validate`, `.execute`): without it, the screen says so instead of offering the button.
 */
@Component({
  selector: 'alco-import-page',
  imports: [
    RouterLink,
    AlcoButton,
    AlcoCard,
    AlcoErrorState,
    AlcoFormField,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoWorkflowSteps,
  ],
  templateUrl: './import-page.html',
  styleUrl: './import-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportPage {
  private readonly api = inject(TransfersApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  protected readonly transfer = this.route.snapshot.data['transfer'] as ContextualTransfer;
  protected readonly steps = STEPS;
  protected readonly encodings = ENCODINGS;
  protected readonly delimiters = DELIMITERS;

  protected readonly phase = signal<Phase>('file');
  protected readonly run = signal<ImportRunDto | null>(null);
  protected readonly fields = signal<readonly ImportFieldDto[] | null>(null);
  protected readonly file = signal<File | null>(null);
  protected readonly encoding = signal<string>('utf-8');
  protected readonly delimiter = signal<string>(',');
  protected readonly columns = signal<Readonly<Record<string, string>>>({});
  /** The server command running (one at a time). */
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<UserError | null>(null);
  protected readonly mappingIncomplete = signal(false);
  protected readonly refusedRows = signal<readonly ImportRowDto[]>([]);

  protected readonly canValidate = computed(() => this.session.can('imports_exports.validate'));
  protected readonly canExecute = computed(() => this.session.can('imports_exports.execute'));
  protected readonly summary = computed(() => this.run()?.summary ?? {});
  protected readonly creations = computed(
    () => this.summary().preview?.creations[this.transfer.creationKey] ?? 0,
  );
  protected readonly missingRequired = computed(() =>
    (this.fields() ?? []).filter((field) => field.required && !this.columns()[field.name]),
  );

  constructor() {
    this.api.importTypes().subscribe({
      next: (types) =>
        this.fields.set(
          types.find((type) => type.import_type === this.transfer.importType)?.fields ?? [],
        ),
      error: (failure: unknown) => {
        this.fields.set([]);
        this.error.set(toUserError(failure, TRANSFER_ERRORS));
      },
    });
    // Leaving before the end: the unfinished run is cancelled (nothing was imported).
    inject(DestroyRef).onDestroy(() => this.abandon());
  }

  protected label(field: string): string {
    return fieldLabel(this.transfer, field);
  }

  protected onFile(event: Event): void {
    this.file.set((event.target as HTMLInputElement).files?.[0] ?? null);
    this.error.set(null);
  }

  protected onEncoding(event: Event): void {
    this.encoding.set((event.target as HTMLSelectElement).value);
  }

  protected onDelimiter(event: Event): void {
    this.delimiter.set((event.target as HTMLSelectElement).value);
  }

  protected onColumn(field: string, event: Event): void {
    const header = (event.target as HTMLSelectElement).value;
    const next = { ...this.columns() };
    if (header) {
      next[field] = header;
    } else {
      delete next[field];
    }
    this.columns.set(next);
    this.mappingIncomplete.set(false);
  }

  /** Step 1: a new run, the file sent, then read with the chosen encoding and separator. */
  protected async send(): Promise<void> {
    const file = this.file();
    const type = this.transfer.importType;
    if (!file || !type) {
      return;
    }
    await this.command('upload', async () => {
      this.abandon();
      const created = await firstValueFrom(this.api.createImport(type));
      this.run.set(created);
      await firstValueFrom(this.api.upload(created.public_id, file));
      const parsed = await firstValueFrom(
        this.api.parse(created.public_id, {
          encoding: this.encoding(),
          delimiter: this.delimiter(),
        }),
      );
      this.run.set(parsed);
      this.columns.set(this.suggestColumns(parsed.headers));
      this.phase.set('mapping');
    });
  }

  /** Step 2: the mapping, then the checks of every row (nothing written). */
  protected async confirmMapping(): Promise<void> {
    const run = this.run();
    if (!run) {
      return;
    }
    if (this.missingRequired().length > 0) {
      this.mappingIncomplete.set(true);
      return;
    }
    await this.command('map', async () => {
      const mapped = await firstValueFrom(this.api.map(run.public_id, this.columns()));
      this.run.set(mapped);
      if (!this.canValidate()) {
        this.phase.set('checks');
        return;
      }
      const checked = await firstValueFrom(this.api.validate(run.public_id));
      this.run.set(checked);
      this.refusedRows.set(
        checked.summary.errors
          ? (await firstValueFrom(this.api.rows(run.public_id, 'error'))).results
          : [],
      );
      this.phase.set('checks');
    });
  }

  /** Step 3: what the import would do, still without writing anything. */
  protected async showPreview(): Promise<void> {
    const run = this.run();
    if (!run) {
      return;
    }
    await this.command('preview', async () => {
      this.run.set(await firstValueFrom(this.api.preview(run.public_id)));
      this.phase.set('preview');
    });
  }

  /** Step 4: the only write, all or nothing, after a confirmation. */
  protected async execute(): Promise<void> {
    const run = this.run();
    if (!run) {
      return;
    }
    const count = this.creations();
    const confirmed = await this.confirm.confirm({
      title: `${this.transfer.importLabel} ?`,
      message: `${this.transfer.countLabel(count)} ${count > 1 ? 'seront créés' : 'sera créé'}. Tout ou rien : si le serveur refuse une ligne, rien n’est importé.`,
      confirmLabel: 'Lancer l’import',
    });
    if (!confirmed) {
      return;
    }
    await this.command('execute', async () => {
      const done = await firstValueFrom(this.api.execute(run.public_id));
      this.run.set(done);
      this.phase.set('done');
      if (done.status === 'completed') {
        this.toast.success(`Import terminé : ${this.transfer.countLabel(this.imported())}.`);
      }
    });
  }

  protected imported(): number {
    return this.summary().created ?? this.creations();
  }

  /** Another file: the current run is abandoned (cancelled on the server when allowed). */
  protected restart(): void {
    this.abandon();
    this.run.set(null);
    this.file.set(null);
    this.columns.set({});
    this.refusedRows.set([]);
    this.error.set(null);
    this.phase.set('file');
  }

  protected rowText(row: ImportRowDto): string {
    return row.messages
      .filter((message) => message.level === 'error')
      .map((message) => this.messageText(message))
      .join(' ');
  }

  protected rowsLabel(count: number): string {
    return `${count} ligne${count > 1 ? 's' : ''}`;
  }

  protected back(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  private messageText(message: ImportMessageDto): string {
    const field = message.field ? `${this.label(message.field)} : ` : '';
    return `${field}${rowMessage(message)}`;
  }

  /** Header named like the field or its label (a suggestion the user checks). */
  private suggestColumns(headers: readonly string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const field of this.fields() ?? []) {
      const names = [comparable(field.name), comparable(this.label(field.name))];
      const header = headers.find((candidate) => names.includes(comparable(candidate)));
      if (header) {
        result[field.name] = header;
      }
    }
    return result;
  }

  private async command(name: string, work: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(name);
    this.error.set(null);
    try {
      await work();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.error.set(toUserError(error, TRANSFER_ERRORS));
      }
    } finally {
      this.busy.set(null);
    }
  }

  private abandon(): void {
    const run = this.run();
    if (
      run &&
      !['completed', 'failed', 'cancelled'].includes(run.status) &&
      this.session.can('imports_exports.cancel')
    ) {
      this.api.cancel(run.public_id, 'Abandonné depuis l’écran d’import.').subscribe({
        error: () => undefined,
      });
    }
  }
}
