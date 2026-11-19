import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AUDIT_ORIGINS, actionText, objectLink, objectText, valueText } from './audit-presentation';
import { AuditApi } from './data-access/audit-api';

interface Change {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

/** One event of the journal: who, when, from where, and each field changed. */
@Component({
  selector: 'alco-audit-event',
  imports: [DatePipe, RouterLink, AlcoCard, AlcoErrorState, AlcoLoading, AlcoPageHeader],
  templateUrl: './audit-event.html',
  styleUrl: './audit-event.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditEventPage {
  private readonly api = inject(AuditApi);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly eventId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly event = requestState(() => this.api.event(this.eventId));
  protected readonly title = computed(() => {
    const event = this.event.value();
    return event ? `${actionText(event.action)} — ${objectText(event.object_type)}` : 'Événement';
  });
  protected readonly link = computed(() => {
    const event = this.event.value();
    return event ? objectLink(event.object_type, event.object_id) : null;
  });
  protected readonly origin = computed(() => {
    const origin = this.event.value()?.origin ?? '';
    return AUDIT_ORIGINS[origin] ?? origin;
  });
  /** The values are given to holders of `audit.read_sensitive` only. */
  protected readonly valuesShown = computed(() => {
    const event = this.event.value();
    return event !== null && (event.before != null || event.after != null);
  });
  protected readonly changes = computed<readonly Change[]>(() => {
    const event = this.event.value();
    if (!event) {
      return [];
    }
    return event.changed_fields.map((field) => ({
      field,
      before: valueText(event.before?.[field]),
      after: valueText(event.after?.[field]),
    }));
  });
  protected readonly loadError = computed(() => {
    const error = this.event.error();
    return error ? toUserError(error) : null;
  });

  constructor() {
    effect(() => {
      const event = this.event.value();
      if (event) {
        untracked(() => this.breadcrumbs.nameCurrent(actionText(event.action)));
      }
    });
  }
}
