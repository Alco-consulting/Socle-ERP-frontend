import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';

import { requestState } from '../../../core/http/request-state';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AuditApi, AuditEvent } from '../../audit/data-access/audit-api';
import { AUDIT_ACTIONS } from './entry-presentation';

/** The backend's audit name of an entry (model label of `JournalEntry`). */
export const ENTRY_AUDIT_TYPE = 'accounting.journalentry';

/**
 * History of an entry from the backend's Audit (`audit.read`): who did what, when, oldest
 * first. Read only; no audit screen of its own.
 */
@Component({
  selector: 'alco-entry-history',
  imports: [DatePipe, AlcoErrorState, AlcoLoading],
  template: `
    <h2 id="history-title" class="alco-section-title">Historique</h2>
    @switch (history.status()) {
      @case ('forbidden') {
        <p class="note">Votre profil ne permet pas de consulter l’historique.</p>
      }
      @case ('error') {
        <alco-error-state
          [inline]="true"
          title="L’historique n’a pas pu être chargé."
          message="Réessayez dans un instant."
          retryLabel="Réessayer"
          (retry)="history.reload()"
        />
      }
      @case ('loading') {
        <alco-loading [rows]="3" label="Chargement de l’historique…" />
      }
      @default {
        @if (events().length === 0) {
          <p class="note">Aucun événement enregistré.</p>
        } @else {
          <ol class="events">
            @for (event of events(); track event.public_id) {
              <li>
                <span class="action">{{ actionLabel(event) }}</span>
                <span class="meta">
                  le {{ event.occurred_at | date: 'dd/MM/yyyy à HH:mm' }} ·
                  {{ event.user?.email ?? 'Système' }}
                </span>
              </li>
            }
          </ol>
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
    .note {
      margin: 0;
      color: var(--color-text-muted);
    }
    .events {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0 0 0 var(--space-4);
      border-left: 2px solid var(--color-border);
      list-style: none;
    }
    .events li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
    }
    .action {
      font-weight: var(--font-weight-medium);
    }
    .meta {
      color: var(--color-text-muted);
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoEntryHistory {
  private readonly api = inject(AuditApi);

  readonly entryId = input.required<string>();

  protected readonly history = requestState(
    () => this.api.history(ENTRY_AUDIT_TYPE, untracked(this.entryId)),
    { immediate: false },
  );
  protected readonly events = computed(() => this.history.value()?.results ?? []);

  constructor() {
    effect(() => {
      this.entryId();
      untracked(() => this.history.reload());
    });
  }

  /** Reload after a command of the record (a new event). */
  reload(): void {
    this.history.reload();
  }

  protected actionLabel(event: AuditEvent): string {
    return AUDIT_ACTIONS[event.action] ?? event.action;
  }
}
