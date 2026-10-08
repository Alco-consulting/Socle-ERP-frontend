import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { APP_CONFIG } from '../../core/config/app-config';
import { ApiClient, ApiFile, Paginated } from '../../core/http/api-client';

/**
 * Imports and exports of the API (`/imports-exports/`, backend/docs/api/openapi.yaml).
 * A capability used FROM each domain (Tiers › Actions ▾ › Importer des tiers), never an
 * application or a screen of its own. Every step of an import is a server command: the
 * status is never changed here.
 */

/** The `content_type` of a run whose file is an Excel workbook (.xlsx). */
export const WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** `created → uploaded → parsed → mapped → validated → previewed → completed` (or failed, cancelled). */
export type ImportStatus =
  | 'created'
  | 'uploaded'
  | 'parsed'
  | 'mapped'
  | 'validated'
  | 'previewed'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Checks of the `validate` command, then `preview` and `execute` add theirs. */
export interface ImportSummary {
  readonly total?: number;
  readonly valid?: number;
  readonly warnings?: number;
  readonly errors?: number;
  readonly duplicates?: number;
  readonly preview?: {
    readonly creations: Readonly<Record<string, number>>;
    readonly updates: number;
    readonly skipped_duplicates: number;
  };
  /** After `execute`: objects created, rows imported. */
  readonly created?: number;
  readonly imported?: number;
}

/** `ImportRunSerializer`. */
export interface ImportRunDto {
  readonly public_id: string;
  readonly import_type: string;
  readonly status: ImportStatus;
  readonly filename: string;
  /** What the server found the file to be: `text/csv` or `WORKBOOK_CONTENT_TYPE`. */
  readonly content_type?: string;
  readonly headers: readonly string[];
  readonly columns: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, string>>;
  readonly summary: ImportSummary;
  readonly error: Readonly<Record<string, unknown>>;
}

/** One message of a row (`Message.as_dict`): the code is stable, the text is the server's. */
export interface ImportMessageDto {
  readonly level: 'error' | 'warning' | 'info';
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** `ImportRowSerializer`. */
export interface ImportRowDto {
  readonly line_number: number;
  readonly status: 'pending' | 'valid' | 'warning' | 'error' | 'duplicate' | 'imported';
  readonly raw: Readonly<Record<string, string>>;
  readonly messages: readonly ImportMessageDto[];
}

/** `ImportTypeSerializer`: the fields of an importer (`GET import-types/`). */
export interface ImportFieldDto {
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
}

export interface ImportTypeDto {
  readonly import_type: string;
  readonly fields: readonly ImportFieldDto[];
}

/** `ExportRunSerializer`. */
export interface ExportRunDto {
  readonly public_id: string;
  readonly export_type: string;
  readonly status: 'pending' | 'completed' | 'failed' | 'expired';
  readonly filename: string;
  readonly row_count: number | null;
  readonly error: Readonly<Record<string, unknown>>;
}

/** Choices of the server (`parsing.py`): nothing is guessed from the file. */
export const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-8-sig', label: 'UTF-8 avec BOM (Excel)' },
  { id: 'cp1252', label: 'Windows (cp1252)' },
  { id: 'latin-1', label: 'Latin-1 (ISO-8859-1)' },
] as const;

export const DELIMITERS = [
  { id: ',', label: 'Virgule ( , )' },
  { id: ';', label: 'Point-virgule ( ; )' },
  { id: '\t', label: 'Tabulation' },
  { id: '|', label: 'Barre verticale ( | )' },
] as const;

/** Reading of dates and amounts (`date_format`, `decimal_separator` of `mapping.py`). */
export const DATE_FORMATS = [
  { id: '%Y-%m-%d', label: 'AAAA-MM-JJ (2026-09-30)' },
  { id: '%d/%m/%Y', label: 'JJ/MM/AAAA (30/09/2026)' },
  { id: '%d.%m.%Y', label: 'JJ.MM.AAAA (30.09.2026)' },
  { id: '%Y%m%d', label: 'AAAAMMJJ (20260930)' },
] as const;

export const DECIMAL_SEPARATORS = [
  { id: '.', label: 'Point (1250.50)' },
  { id: ',', label: 'Virgule (1250,50)' },
] as const;

/** How the file writes its values (`options` of the mapping); the server's defaults otherwise. */
export interface ImportOptions {
  readonly date_format?: string;
  readonly decimal_separator?: string;
}

const imports = 'imports-exports/imports/';

@Injectable({ providedIn: 'root' })
export class TransfersApi {
  private readonly api = inject(ApiClient);
  /** Checking or importing a large file (a chart of 1 245 accounts) takes longer than a read. */
  private readonly longCommand = { timeoutMs: inject(APP_CONFIG).uploadTimeoutMs };

  importTypes(): Observable<readonly ImportTypeDto[]> {
    return this.api.get<readonly ImportTypeDto[]>('imports-exports/import-types/');
  }

  createImport(importType: string): Observable<ImportRunDto> {
    return this.api.post<ImportRunDto>(imports, { import_type: importType });
  }

  upload(runId: string, file: File): Observable<ImportRunDto> {
    const data = new FormData();
    data.append('file', file, file.name);
    return this.api.upload<ImportRunDto>(`${imports}${runId}/upload/`, data);
  }

  /** Without `encoding` or `delimiter`, the server reads them from the file (and returns them in `options`). */
  parse(
    runId: string,
    options: { encoding?: string; delimiter?: string; sheet?: string } = {},
  ): Observable<ImportRunDto> {
    return this.api.post<ImportRunDto>(`${imports}${runId}/parse/`, options);
  }

  /** `columns`: field of the importer → column of the file; `options`: how values are written. */
  map(
    runId: string,
    columns: Readonly<Record<string, string>>,
    options: ImportOptions = {},
  ): Observable<ImportRunDto> {
    return this.api.post<ImportRunDto>(`${imports}${runId}/map/`, { columns, options });
  }

  validate(runId: string): Observable<ImportRunDto> {
    return this.api.post<ImportRunDto>(`${imports}${runId}/validate/`, null, this.longCommand);
  }

  preview(runId: string): Observable<ImportRunDto> {
    return this.api.post<ImportRunDto>(`${imports}${runId}/preview/`);
  }

  /** Synchronous: the answer is the finished run (completed or failed). */
  execute(runId: string): Observable<ImportRunDto> {
    return this.api.post<ImportRunDto>(
      `${imports}${runId}/execute/`,
      { asynchronous: false },
      this.longCommand,
    );
  }

  cancel(runId: string, reason: string): Observable<ImportRunDto> {
    return this.api.post<ImportRunDto>(`${imports}${runId}/cancel/`, { reason });
  }

  /** Rows refused by the checks, one page (the report of what to correct). */
  rows(
    runId: string,
    status: ImportRowDto['status'],
    page = 1,
  ): Observable<Paginated<ImportRowDto>> {
    return this.api.get<Paginated<ImportRowDto>>(`${imports}${runId}/rows/`, {
      params: { status, page, page_size: 50 },
    });
  }

  /** The first rows read from the file, as staged (raw values by column), in line order. */
  firstRows(runId: string, count: number): Observable<Paginated<ImportRowDto>> {
    return this.api.get<Paginated<ImportRowDto>>(`${imports}${runId}/rows/`, {
      params: { page: 1, page_size: count },
    });
  }

  /** Synchronous export: the answer is the finished export (completed or failed). */
  createExport(
    exportType: string,
    parameters: Readonly<Record<string, string>>,
  ): Observable<ExportRunDto> {
    return this.api.post<ExportRunDto>('imports-exports/exports/', {
      export_type: exportType,
      parameters,
      asynchronous: false,
    });
  }

  download(exportId: string): Observable<ApiFile> {
    return this.api.getFile(`imports-exports/exports/${exportId}/download/`);
  }
}
