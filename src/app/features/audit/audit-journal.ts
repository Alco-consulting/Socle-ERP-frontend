import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import {
  ACTION_FILTERS,
  OBJECT_FILTERS,
  actionText,
  objectLink,
  objectText,
} from './audit-presentation';
import { AuditApi, AuditEvent, JOURNAL_PAGE_SIZE } from './data-access/audit-api';

/** Comptabilité › Audit › Journal d'audit: who did what and when, the newest first. */
@Component({
  selector: 'alco-audit-journal',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoPagination,
    AlcoTable,
  ],
  templateUrl: './audit-journal.html',
  styleUrl: './audit-journal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditJournalPage {
  private readonly api = inject(AuditApi);

  protected readonly actions = ACTION_FILTERS;
  protected readonly objects = OBJECT_FILTERS;
  protected readonly pageSize = JOURNAL_PAGE_SIZE;
  protected readonly page = signal(1);
  protected readonly filters = new FormGroup({
    dateFrom: new FormControl('', { nonNullable: true }),
    dateTo: new FormControl('', { nonNullable: true }),
    action: new FormControl('', { nonNullable: true }),
    objectType: new FormControl('', { nonNullable: true }),
    search: new FormControl('', { nonNullable: true }),
  });
  protected readonly events = requestState(() =>
    this.api.events({ ...this.filters.getRawValue(), page: this.page() }),
  );

  protected readonly columns: readonly TableColumn[] = [
    { key: 'when', label: 'Date et heure', width: '11rem' },
    { key: 'user', label: 'Utilisateur', hideBelow: 'tablet' },
    { key: 'action', label: 'Action', width: '13rem' },
    { key: 'object', label: 'Objet' },
  ];
  protected readonly rowId = (event: AuditEvent) => event.public_id;

  protected readonly loadError = computed(() => {
    const error = this.events.error();
    return error ? toUserError(error) : null;
  });

  constructor() {
    // A filter changed: back to the first page (typing in the search waits a little).
    this.filters.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe(() => {
      this.page.set(1);
      this.events.reload();
    });
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.events.reload();
  }

  protected hasFilters(): boolean {
    return Object.values(this.filters.getRawValue()).some((value) => value !== '');
  }

  protected clear(): void {
    this.filters.reset();
  }

  protected actionLabel(event: AuditEvent): string {
    return actionText(event.action);
  }

  protected objectKind(event: AuditEvent): string {
    return objectText(event.object_type);
  }

  protected link(event: AuditEvent): string | null {
    return objectLink(event.object_type, event.object_id);
  }
}
