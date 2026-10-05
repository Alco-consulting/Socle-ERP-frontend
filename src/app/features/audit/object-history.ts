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

import { requestState } from '../../core/http/request-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AuditApi, AuditEvent } from './data-access/audit-api';

/**
 * The backend's audit names (model labels) of the objects whose history is shown. Only
 * objects the backend audits (`record()` in their services).
 */
export const AUDIT_TYPES = {
  entry: 'accounting.journalentry',
  journal: 'accounting.journal',
  account: 'accounting.account',
  partner: 'partners.partner',
  lettering: 'accounting.lettering',
  dueSchedule: 'accounting.dueschedule',
  reconciliation: 'treasury.reconciliation',
} as const;

/** Actions of the backend's Audit (`AuditAction`), in words. */
export const AUDIT_ACTIONS: Readonly<Record<string, string>> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  submit: 'Soumission',
  validate: 'Validation',
  reject: 'Renvoi en brouillon',
  lock: 'Verrouillage',
  reverse: 'Contrepassation',
  activate: 'Activation',
  deactivate: 'Désactivation',
  download: 'Lien de téléchargement d’une pièce',
  letter: 'Lettrage',
  unletter: 'Délettrage',
  reconcile: 'Rapprochement bancaire',
  dereconcile: 'Annulation du rapprochement bancaire',
};

/**
 * History of an object from the backend's Audit (`audit.read`): who did what, when, oldest
 * first (`audit/objects/<type>/<id>/`). Read only; Audit is a journal of events, not a
 * discussion thread. `total` is the server's count (smart buttons).
 */
@Component({
  selector: 'alco-object-history',
  imports: [DatePipe, AlcoErrorState, AlcoLoading],
  template: `
    <h2 [id]="titleId()" class="alco-section-title">Historique</h2>
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
export class AlcoObjectHistory {
  private readonly api = inject(AuditApi);

  /** The object's audit name (`AUDIT_TYPES`) and public id. */
  readonly objectType = input.required<string>();
  readonly objectId = input.required<string>();
  /** Id of the heading (the section that holds the history is labelled by it). */
  readonly titleId = input('history-title');

  protected readonly history = requestState(
    () => this.api.history(untracked(this.objectType), untracked(this.objectId)),
    { immediate: false },
  );
  protected readonly events = computed(() => this.history.value()?.results ?? []);
  /** The server's count of events, once loaded. */
  readonly total = computed(() => this.history.value()?.count ?? null);

  constructor() {
    effect(() => {
      this.objectType();
      this.objectId();
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
