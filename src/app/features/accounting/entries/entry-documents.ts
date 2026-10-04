import { DOCUMENT, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { DocumentsApi, StoredDocument } from '../../documents/data-access/documents-api';
import { ENTRY_ERRORS } from './entry-presentation';

/** Resource type registered by the backend for an entry (apps/accounting/attachments.py). */
export const ENTRY_RESOURCE_TYPE = 'accounting.entry';

/** « 12 Ko », « 1,4 Mo » (display only). */
function fileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} o`;
  }
  const kilo = bytes / 1024;
  return kilo < 1024
    ? `${Math.round(kilo)} Ko`
    : `${(kilo / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Supporting documents of an entry, through the Documents API: the list (`documents.read`),
 * a download link (`documents.download`) and the upload of a file while the entry is a draft
 * (`documents.upload`; the server refuses otherwise: `document_resource_frozen`).
 */
@Component({
  selector: 'alco-entry-documents',
  imports: [DatePipe, AlcoButton, AlcoErrorState, AlcoIcon, AlcoLoading],
  template: `
    <div class="head">
      <h2 id="documents-title" class="alco-section-title">Pièces justificatives</h2>
      @if (canUpload()) {
        <input
          #file
          class="alco-sr-only"
          type="file"
          tabindex="-1"
          aria-hidden="true"
          (change)="onFile($event)"
        />
        <button
          alcoButton
          type="button"
          size="sm"
          icon="upload"
          [loading]="uploading()"
          loadingLabel="Envoi…"
          (click)="file.click()"
        >
          Joindre un fichier
        </button>
      }
    </div>
    @if (actionError(); as failure) {
      <alco-error-state
        [inline]="true"
        [title]="failure.title"
        [message]="failure.message"
        [code]="failure.code"
        [correlationId]="failure.correlationId ?? ''"
      />
    }
    @switch (documents.status()) {
      @case ('forbidden') {
        <p class="note">Votre profil ne permet pas de voir les pièces de cette écriture.</p>
      }
      @case ('error') {
        <alco-error-state
          [inline]="true"
          title="Les pièces n’ont pas pu être chargées."
          message="Réessayez dans un instant."
          retryLabel="Réessayer"
          (retry)="documents.reload()"
        />
      }
      @case ('loading') {
        <alco-loading [rows]="2" label="Chargement des pièces…" />
      }
      @default {
        @if (rows().length === 0) {
          <p class="note">
            Aucune pièce jointe.
            @if (!editable()) {
              Les pièces se joignent tant que l’écriture est un brouillon.
            }
          </p>
        } @else {
          <ul class="files">
            @for (document of rows(); track document.public_id) {
              <li>
                <alco-icon name="attachment" [size]="16" />
                <span class="name">{{ document.original_name }}</span>
                <span class="meta">
                  {{ size(document.size) }} · ajoutée le
                  {{ document.created_at | date: 'dd/MM/yyyy' }}
                </span>
                @if (canDownload()) {
                  <button
                    alcoButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon="download"
                    [disabled]="opening() !== null"
                    [loading]="opening() === document.public_id"
                    loadingLabel="Ouverture…"
                    (click)="download(document)"
                  >
                    Ouvrir <span class="alco-sr-only">{{ document.original_name }}</span>
                  </button>
                }
              </li>
            }
          </ul>
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .note {
      margin: 0;
      color: var(--color-text-muted);
    }
    .files {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .files li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
    }
    .name {
      font-weight: var(--font-weight-medium);
      overflow-wrap: anywhere;
    }
    .meta {
      color: var(--color-text-muted);
      font-size: var(--font-size-caption);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoEntryDocuments {
  private readonly api = inject(DocumentsApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly window = inject(DOCUMENT).defaultView;

  readonly entryId = input.required<string>();
  /** The entry is a draft: its documents may still change. */
  readonly editable = input(false);

  protected readonly documents = requestState(
    () => this.api.attachedTo(ENTRY_RESOURCE_TYPE, untracked(this.entryId)),
    { immediate: false },
  );
  protected readonly rows = computed(() => this.documents.value()?.results ?? []);
  protected readonly canUpload = computed(
    () => this.editable() && this.session.can('documents.upload'),
  );
  protected readonly canDownload = computed(() => this.session.can('documents.download'));
  protected readonly uploading = signal(false);
  protected readonly opening = signal<string | null>(null);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly size = fileSize;
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('file');

  constructor() {
    effect(() => {
      this.entryId();
      untracked(() => this.documents.reload());
    });
  }

  protected async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.uploading()) {
      return;
    }
    this.uploading.set(true);
    this.actionError.set(null);
    try {
      await firstValueFrom(this.api.upload(ENTRY_RESOURCE_TYPE, this.entryId(), file));
      this.toast.success(`Pièce « ${file.name} » jointe.`);
      this.documents.reload();
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.uploading.set(false);
      const input = this.fileInput()?.nativeElement;
      if (input) {
        input.value = '';
      }
    }
  }

  /** A short-lived signed link of the server, opened at once and never kept. */
  protected async download(document: StoredDocument): Promise<void> {
    this.opening.set(document.public_id);
    this.actionError.set(null);
    try {
      const link = await firstValueFrom(this.api.downloadLink(document.public_id));
      const url = this.safeUrl(link.url);
      if (!url) {
        this.actionError.set({
          code: '', // the front end's own refusal: no code of the API
          title: 'Le lien de cette pièce a été refusé.',
          message: 'Il ne pointe pas vers une adresse sûre. Contactez l’administrateur.',
        });
        return;
      }
      if (!this.openDetached(url)) {
        // Pop-up blocked: the user opens it with a click (the link stays valid a few minutes).
        this.toast.show('info', `Le lien de « ${document.original_name} » est prêt.`, {
          actionLabel: 'Ouvrir',
          action: () => this.openDetached(url),
        });
      }
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.opening.set(null);
    }
  }

  /**
   * A new tab without access to this one. Not the `noopener` feature: the browser would then
   * return null even when the tab opened. `false` when a pop-up blocker refused it.
   */
  private openDetached(url: string): boolean {
    const opened = this.window?.open(url, '_blank');
    if (opened) {
      opened.opener = null;
    }
    return !!opened;
  }

  /** Only an https link, or one of this application's own origin (development). */
  private safeUrl(raw: string): string | null {
    try {
      const origin = this.window?.location.origin ?? '';
      const url = new URL(raw, origin);
      return url.protocol === 'https:' || url.origin === origin ? url.href : null;
    } catch {
      return null;
    }
  }

  private fail(failure: unknown): void {
    const error = toApiError(failure);
    if (error.kind !== 'unauthenticated') {
      this.actionError.set(toUserError(error, ENTRY_ERRORS));
    }
  }
}
