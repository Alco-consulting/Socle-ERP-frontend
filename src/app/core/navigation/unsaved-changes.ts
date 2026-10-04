import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SessionStore } from '../session/session.store';

/** The question, the same everywhere (navigation, company switch). */
export const UNSAVED_CHANGES_QUESTION = {
  title: 'Modifications non enregistrées',
  message: 'Voulez-vous vraiment quitter ? Les modifications saisies seront perdues.',
  cancelLabel: 'Continuer l’édition',
  confirmLabel: 'Quitter',
  tone: 'danger',
} as const;

/**
 * Forms with changes not saved yet. A form screen says, while it lives, whether it holds
 * any (`track`); leaving it (`unsavedChangesGuard`), switching company
 * (`CompanyContextService.switchTo`) or closing the tab asks first. A session that ended
 * asks nothing: the login screen takes over.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChangesService {
  private readonly confirm = inject(AlcoConfirmService);
  private readonly store = inject(SessionStore);
  private readonly sources = new Set<() => boolean>();
  private pending: Promise<boolean> | null = null;

  constructor() {
    const window = inject(DOCUMENT).defaultView;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (this.hasChanges()) {
        event.preventDefault(); // the browser asks with its own words
      }
    };
    window?.addEventListener('beforeunload', onBeforeUnload);
    inject(DestroyRef).onDestroy(() => window?.removeEventListener('beforeunload', onBeforeUnload));
  }

  /**
   * Called by a form screen in its injection context: `isDirty` is read until the screen is
   * destroyed. A screen marks its form pristine once saved, before it navigates.
   */
  track(isDirty: () => boolean, destroyRef: DestroyRef = inject(DestroyRef)): void {
    this.sources.add(isDirty);
    destroyRef.onDestroy(() => this.sources.delete(isDirty));
  }

  hasChanges(): boolean {
    return this.store.authenticated() && [...this.sources].some((isDirty) => isDirty());
  }

  /** `true` when nothing would be lost, or when the user chose to leave anyway. */
  confirmDiscard(): Promise<boolean> {
    if (!this.hasChanges()) {
      return Promise.resolve(true);
    }
    // One question at a time (a guard and a company switch at once).
    this.pending ??= this.confirm.confirm(UNSAVED_CHANGES_QUESTION).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

/** `canDeactivate` of the form screens. */
export const unsavedChangesGuard: CanDeactivateFn<unknown> = () =>
  inject(UnsavedChangesService).confirmDiscard();
