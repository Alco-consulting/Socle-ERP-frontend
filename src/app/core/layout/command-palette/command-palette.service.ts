import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { Injectable, inject } from '@angular/core';

import { AlcoCommandPalette } from './command-palette';

/** Opens the global search, once at a time (the top bar's button, Ctrl+K anywhere). */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);
  private ref: DialogRef<unknown, AlcoCommandPalette> | null = null;

  open(): void {
    if (this.ref) {
      return;
    }
    const ref = this.dialog.open(AlcoCommandPalette, {
      ariaLabel: 'Recherche globale',
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      positionStrategy: this.overlay.position().global().centerHorizontally().top('12vh'),
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    this.ref = ref;
    ref.closed.subscribe(() => (this.ref = null));
  }

  /** Ctrl+K (⌘K on a Mac), even from a field: the browser's own use of it is overridden. */
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.open();
    }
  }
}
