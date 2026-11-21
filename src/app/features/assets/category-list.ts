import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { ASSET_ERRORS, durationText } from './assets-presentation';
import { AssetsApi } from './data-access/assets-api';
import { AssetCategory } from './data-access/assets-models';

/** Comptabilité › Configuration › Immobilisations › Catégories, with the usual ones on demand. */
@Component({
  selector: 'alco-asset-category-list',
  imports: [
    RouterLink,
    AlcoButton,
    AlcoCell,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './category-list.html',
  styleUrl: './assets-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetCategoryListPage {
  private readonly api = inject(AssetsApi);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly canManage = computed(() => this.session.can('assets.manage_categories'));
  protected readonly creatingDefaults = signal(false);
  protected readonly categories = requestState(() =>
    this.api.categories().pipe(map((page) => page.results)),
  );
  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code', width: '7rem' },
    { key: 'name', label: 'Nom' },
    { key: 'account', label: 'Compte', width: '9rem', hideBelow: 'tablet' },
    { key: 'duration', label: 'Durée', width: '9rem' },
  ];
  protected readonly rowId = (row: AssetCategory) => row.public_id;
  protected readonly loadError = computed(() => {
    const error = this.categories.error();
    return error ? toUserError(error, ASSET_ERRORS) : null;
  });

  protected durationOf(row: AssetCategory): string {
    return durationText(row.default_duration_months);
  }

  protected async createDefaults(): Promise<void> {
    this.creatingDefaults.set(true);
    try {
      const result = await firstValueFrom(this.api.createDefaultCategories());
      const created = result.created.length;
      this.toast.success(
        created === 0
          ? 'Les catégories usuelles existent déjà.'
          : `${created} catégorie${created > 1 ? 's' : ''} créée${created > 1 ? 's' : ''}.`,
      );
      this.categories.reload();
    } catch (failure) {
      const error = toUserError(failure, ASSET_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.creatingDefaults.set(false);
    }
  }
}
