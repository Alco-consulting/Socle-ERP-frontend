import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoPagination } from '../../shared/ui/pagination/pagination';
import { referencePlaces } from '../currencies/reference-places';
import { ASSET_ERRORS, ASSET_STATUS } from './assets-presentation';
import { ASSET_PAGE_SIZE, AssetsApi } from './data-access/assets-api';
import { Asset } from './data-access/assets-models';

/** Comptabilité › Immobilisations › Actifs: each asset, its gross value and net book value. */
@Component({
  selector: 'alco-asset-list',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
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
  templateUrl: './asset-list.html',
  styleUrl: './assets-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetListPage {
  private readonly api = inject(AssetsApi);
  private readonly session = inject(SessionStore);

  protected readonly canCreate = computed(() => this.session.can('assets.create'));
  protected readonly places = referencePlaces();
  protected readonly pageSize = ASSET_PAGE_SIZE;
  protected readonly page = signal(1);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly assets = requestState(() =>
    this.api.assets({ search: this.search.value.trim(), page: this.page() }),
  );
  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', label: 'Nom' },
    { key: 'category', label: 'Catégorie', width: '8rem', hideBelow: 'tablet' },
    { key: 'date', label: 'Acquise le', width: '8rem', hideBelow: 'tablet' },
    { key: 'gross', label: 'Valeur brute', width: '10rem', numeric: true },
    { key: 'net', label: 'Valeur nette', width: '10rem', numeric: true },
    { key: 'status', label: 'État', width: '8rem' },
  ];
  protected readonly rowId = (row: Asset) => row.public_id;
  protected readonly loadError = computed(() => {
    const error = this.assets.error();
    return error ? toUserError(error, ASSET_ERRORS) : null;
  });

  constructor() {
    this.search.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe(() => {
      this.page.set(1);
      this.assets.reload();
    });
  }

  protected statusLook(row: Asset) {
    return ASSET_STATUS[row.status];
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.assets.reload();
  }
}
