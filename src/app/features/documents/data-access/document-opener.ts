import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { UserError } from '../../../core/errors/user-error';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { DocumentsApi, StoredDocument } from './documents-api';

/** The front end's own refusal of a link: no code of the API. */
const UNSAFE_LINK: UserError = {
  code: '',
  title: 'Le lien de cette pièce a été refusé.',
  message: 'Il ne pointe pas vers une adresse sûre. Contactez l’administrateur.',
};

/** Opens a document through a short-lived signed link of the server, never kept. */
@Injectable({ providedIn: 'root' })
export class DocumentOpener {
  private readonly api = inject(DocumentsApi);
  private readonly toast = inject(AlcoToastService);
  private readonly window = inject(DOCUMENT).defaultView;

  /** `null` once opened (or offered in a toast); the refusal otherwise. Throws API errors. */
  async open(document: StoredDocument): Promise<UserError | null> {
    const link = await firstValueFrom(this.api.downloadLink(document.public_id));
    const url = this.safeUrl(link.url);
    if (!url) {
      return UNSAFE_LINK;
    }
    if (!this.openDetached(url)) {
      // Pop-up blocked: the user opens it with a click (the link stays valid a few minutes).
      this.toast.show('info', `Le lien de « ${document.original_name} » est prêt.`, {
        actionLabel: 'Ouvrir',
        action: () => this.openDetached(url),
      });
    }
    return null;
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
}
