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
import { AlcoBadge } from '../../../shared/ui/badge/badge';
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
  DATE_FORMATS,
  DECIMAL_SEPARATORS,
  DELIMITERS,
  ENCODINGS,
  ImportFieldDto,
  ImportMessageDto,
  ImportRowDto,
  ImportRunDto,
  TransfersApi,
  WORKBOOK_CONTENT_TYPE,
} from '../transfers-api';

const IMPORT_UNAVAILABLE = {
  title: 'Cet import n’est pas disponible.',
  message: 'Le serveur ne le propose pas : rien ne peut être importé ici pour le moment.',
};

/**
 * `sheet`: a workbook with several sheets of data waits for the user's choice; `read`: the
 * file was read, what the server found and its first rows are shown before the mapping.
 */
type Phase = 'file' | 'sheet' | 'read' | 'mapping' | 'checks' | 'preview' | 'done';

/** CSV/TXT text or an Excel workbook (.xlsx), read by the server. */
const READABLE = /\.(csv|txt|xlsx)$/i;
const NOT_READABLE = {
  title: 'Format non pris en charge. Utilisez un fichier CSV ou Excel (.xlsx).',
  message: 'Les classeurs .xls et .xlsm (avec macros) ne sont pas lus : enregistrez-le en .xlsx.',
};
const DAMAGED = {
  title: 'Ce classeur ne peut pas être lu.',
  message:
    'Il est endommagé ou n’est pas un vrai fichier Excel : ouvrez-le et enregistrez-le en .xlsx.',
};
/** Why the server refused the file (`details.reason` of `imports_file_rejected`), in words. */
const FILE_REJECTIONS: Readonly<Record<string, { title: string; message: string }>> = {
  extension: NOT_READABLE,
  'not a text file': NOT_READABLE,
  'binary content': NOT_READABLE,
  'not a workbook': DAMAGED,
  corrupt: DAMAGED,
  encrypted: {
    title: 'Ce classeur est protégé par un mot de passe.',
    message: 'Enregistrez-le sans mot de passe, puis choisissez-le à nouveau.',
  },
  macros: {
    title: 'Ce classeur contient des macros.',
    message:
      'Les macros ne sont jamais lues : enregistrez-le en classeur Excel (.xlsx) sans macros.',
  },
  'too many parts': DAMAGED,
  'too large once uncompressed': {
    title: 'Ce classeur est trop volumineux.',
    message: 'Gardez seulement la feuille à importer, ou découpez le fichier.',
  },
};
/** First rows shown once the file is read (never the whole file). */
const PREVIEW_ROWS = 5;

const STEPS = [
  { id: 'file', label: 'Fichier' },
  { id: 'read', label: 'Lecture' },
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
 * The user only chooses the file (CSV/TXT or Excel .xlsx), read by the server: a CSV's
 * encoding and delimiter, a workbook's sheet (chosen by the user when several hold data).
 * What was read and its first rows are shown before the mapping; forcing a CSV's encoding or
 * delimiter stays in « Options avancées », closed by default.
 */
@Component({
  selector: 'alco-import-page',
  imports: [
    RouterLink,
    AlcoBadge,
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
  protected readonly dateFormats = DATE_FORMATS;
  protected readonly decimalSeparators = DECIMAL_SEPARATORS;

  protected readonly phase = signal<Phase>('file');
  protected readonly run = signal<ImportRunDto | null>(null);
  protected readonly fields = signal<readonly ImportFieldDto[] | null>(null);
  protected readonly file = signal<File | null>(null);
  /** « Options avancées »: empty = read from the file by the server (the normal way). */
  protected readonly encoding = signal<string>('');
  protected readonly delimiter = signal<string>('');
  /** How the file writes dates and amounts: the server's defaults unless changed. */
  protected readonly dateFormat = signal<string>(DATE_FORMATS[0].id);
  protected readonly decimalSeparator = signal<string>(DECIMAL_SEPARATORS[0].id);
  /** Rows the server imports with a warning: shown to be checked (nothing refused). */
  protected readonly warningRows = signal<readonly ImportRowDto[]>([]);
  protected readonly columns = signal<Readonly<Record<string, string>>>({});
  /** The server command running (one at a time). */
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<UserError | null>(null);
  protected readonly mappingIncomplete = signal(false);
  protected readonly refusedRows = signal<readonly ImportRowDto[]>([]);

  protected readonly canValidate = computed(() => this.session.can('imports_exports.validate'));
  protected readonly canExecute = computed(() => this.session.can('imports_exports.execute'));
  protected readonly summary = computed(() => this.run()?.summary ?? {});
  /** The step shown: choosing the sheet belongs to the reading. */
  protected readonly step = computed(() => (this.phase() === 'sheet' ? 'read' : this.phase()));
  /** The visible sheets with data, when the server asks which one to read. */
  protected readonly sheets = signal<readonly string[]>([]);
  protected readonly chosenSheet = signal('');
  /** The first rows read (the existing `rows/` endpoint), shown as they are. */
  protected readonly previewRows = signal<readonly ImportRowDto[]>([]);
  /** The file chosen is a workbook: no encoding nor delimiter applies to it. */
  protected readonly chosenIsWorkbook = computed(() => /\.xlsx$/i.test(this.file()?.name ?? ''));
  /** What the server read, as it says it (`content_type`, `options`, `headers` of the run). */
  protected readonly reading = computed(() => {
    const run = this.run();
    const encoding = String(run?.options['encoding'] ?? '');
    const delimiter = String(run?.options['delimiter'] ?? '');
    return {
      filename: run?.filename ?? '',
      workbook: run?.content_type === WORKBOOK_CONTENT_TYPE,
      sheet: String(run?.options['sheet'] ?? ''),
      encoding: ENCODINGS.find((option) => option.id === encoding)?.label ?? encoding,
      delimiter: DELIMITERS.find((option) => option.id === delimiter)?.label ?? delimiter,
      headers: run?.headers ?? [],
      rows: run?.summary.total ?? 0,
      forced: { encoding: this.encoding() !== '', delimiter: this.delimiter() !== '' },
    };
  });
  protected readonly creations = computed(
    () => this.summary().preview?.creations[this.transfer.creationKey] ?? 0,
  );
  protected readonly missingRequired = computed(() =>
    (this.fields() ?? []).filter((field) => field.required && !this.columns()[field.name]),
  );

  constructor() {
    this.api.importTypes().subscribe({
      next: (types) => {
        const offered = types.find((type) => type.import_type === this.transfer.importType);
        this.fields.set(offered?.fields ?? []);
        if (!offered) {
          // The server does not offer this import (yet): no file is sent.
          this.error.set({ ...IMPORT_UNAVAILABLE, code: 'import_type_unavailable' });
        }
      },
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
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0] ?? null;
    this.error.set(null);
    if (chosen && !READABLE.test(chosen.name)) {
      // Refused before sending: the server would refuse it too (Excel, PDF…).
      input.value = '';
      this.file.set(null);
      this.error.set({ ...NOT_READABLE, code: 'imports_file_rejected' });
      return;
    }
    this.file.set(chosen);
  }

  protected onEncoding(event: Event): void {
    this.encoding.set((event.target as HTMLSelectElement).value);
  }

  protected onDelimiter(event: Event): void {
    this.delimiter.set((event.target as HTMLSelectElement).value);
  }

  protected onDateFormat(event: Event): void {
    this.dateFormat.set((event.target as HTMLSelectElement).value);
  }

  protected onDecimalSeparator(event: Event): void {
    this.decimalSeparator.set((event.target as HTMLSelectElement).value);
  }

  /** Whether the importer reads dates or amounts (its fields' kinds, from the server). */
  protected readonly readsDates = computed(() =>
    (this.fields() ?? []).some((field) => field.kind === 'date'),
  );
  protected readonly readsAmounts = computed(() =>
    (this.fields() ?? []).some((field) => field.kind === 'decimal'),
  );

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

  /**
   * Step 1: a new run, the file sent, then read by the server: a CSV's encoding and delimiter,
   * a workbook's sheet. Several sheets with data: the user chooses (never the screen).
   */
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
      this.run.set(await firstValueFrom(this.api.upload(created.public_id, file)));
      await this.read(created.public_id);
    });
  }

  /** The sheet chosen among those the server listed: read it. */
  protected async readSheet(): Promise<void> {
    const run = this.run();
    if (!run || !this.chosenSheet()) {
      return;
    }
    await this.command('sheet', () => this.read(run.public_id, this.chosenSheet()));
  }

  protected onSheet(event: Event): void {
    this.chosenSheet.set((event.target as HTMLInputElement).value);
  }

  private async read(runId: string, sheet = ''): Promise<void> {
    let parsed: ImportRunDto;
    try {
      parsed = await firstValueFrom(
        this.api.parse(runId, {
          ...(this.encoding() && !sheet ? { encoding: this.encoding() } : {}),
          ...(this.delimiter() && !sheet ? { delimiter: this.delimiter() } : {}),
          ...(sheet ? { sheet } : {}),
        }),
      );
    } catch (failure) {
      const error = toApiError(failure);
      const sheets = (error.details as { sheets?: string[] } | null)?.sheets;
      if (error.code === 'imports_sheet_required' && sheets?.length) {
        this.sheets.set(sheets);
        this.chosenSheet.set('');
        this.phase.set('sheet');
        return;
      }
      throw failure;
    }
    this.run.set(parsed);
    this.columns.set(this.suggestColumns(parsed.headers));
    this.previewRows.set((await firstValueFrom(this.api.firstRows(runId, PREVIEW_ROWS))).results);
    this.phase.set('read');
  }

  /** What was read is right: on to the mapping. */
  protected continueToMapping(): void {
    this.phase.set('mapping');
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
      const mapped = await firstValueFrom(
        this.api.map(run.public_id, this.columns(), {
          date_format: this.dateFormat(),
          // A workbook's numbers are read as numbers (written with « . »).
          decimal_separator: this.reading().workbook ? '.' : this.decimalSeparator(),
        }),
      );
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
      this.warningRows.set(
        checked.summary.warnings
          ? (await firstValueFrom(this.api.rows(run.public_id, 'warning'))).results
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
    this.warningRows.set([]);
    this.previewRows.set([]);
    this.sheets.set([]);
    this.chosenSheet.set('');
    this.error.set(null);
    this.phase.set('file');
  }

  protected rowText(row: ImportRowDto): string {
    return row.messages
      .filter((message) => message.level === 'error')
      .map((message) => this.messageText(message))
      .join(' ');
  }

  protected warningText(row: ImportRowDto): string {
    return row.messages
      .filter((message) => message.level === 'warning')
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
      if (error.kind === 'unauthenticated') {
        return;
      }
      const reason = (error.details as { reason?: string } | null)?.reason ?? '';
      const rejected = error.code === 'imports_file_rejected' ? FILE_REJECTIONS[reason] : null;
      this.error.set(
        rejected ? { ...rejected, code: error.code ?? '' } : toUserError(error, TRANSFER_ERRORS),
      );
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
