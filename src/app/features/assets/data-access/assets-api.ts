import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient, Paginated } from '../../../core/http/api-client';
import {
  Asset,
  AssetCategory,
  AssetQuery,
  AssetWrite,
  CategoryWrite,
  DefaultCategories,
  DepreciationPlan,
  DisposalWrite,
  PostedDepreciation,
} from './assets-models';

export const ASSET_PAGE_SIZE = 50;
const CATEGORY_PAGE_SIZE = 100;

const base = 'assets/';
const id = (value: string) => encodeURIComponent(value);

/** The fixed assets of the API (note backend 0060): categories, assets, their plan, posting. */
@Injectable({ providedIn: 'root' })
export class AssetsApi {
  private readonly api = inject(ApiClient);

  categories(status: 'active' | null = null): Observable<Paginated<AssetCategory>> {
    return this.api.get<Paginated<AssetCategory>>(`${base}categories/`, {
      params: { status, page_size: CATEGORY_PAGE_SIZE },
    });
  }

  category(categoryId: string): Observable<AssetCategory> {
    return this.api.get<AssetCategory>(`${base}categories/${id(categoryId)}/`);
  }

  createCategory(category: CategoryWrite): Observable<AssetCategory> {
    return this.api.post<AssetCategory>(`${base}categories/`, category);
  }

  updateCategory(categoryId: string, changes: Partial<CategoryWrite>): Observable<AssetCategory> {
    return this.api.patch<AssetCategory>(`${base}categories/${id(categoryId)}/`, changes);
  }

  /** « Créer les catégories usuelles », with the company's own accounts. */
  createDefaultCategories(): Observable<DefaultCategories> {
    return this.api.post<DefaultCategories>(`${base}categories/defaults/`);
  }

  assets(query: AssetQuery = {}): Observable<Paginated<Asset>> {
    return this.api.get<Paginated<Asset>>(base, {
      params: {
        search: query.search || null,
        status: query.status ?? null,
        page: query.page && query.page > 1 ? query.page : null,
        page_size: ASSET_PAGE_SIZE,
      },
    });
  }

  asset(assetId: string): Observable<Asset> {
    return this.api.get<Asset>(`${base}${id(assetId)}/`);
  }

  createAsset(asset: AssetWrite): Observable<Asset> {
    return this.api.post<Asset>(base, asset);
  }

  updateAsset(assetId: string, changes: Partial<AssetWrite>): Observable<Asset> {
    return this.api.patch<Asset>(`${base}${id(assetId)}/`, changes);
  }

  /** Acquired and put in service at once: its plan exists (note backend 0060). */
  confirm(assetId: string): Observable<Asset> {
    return this.api.post<Asset>(`${base}${id(assetId)}/confirm/`, {});
  }

  cancel(assetId: string, reason: string): Observable<Asset> {
    return this.api.post<Asset>(`${base}${id(assetId)}/cancel/`, { reason });
  }

  dispose(assetId: string, disposal: DisposalWrite): Observable<{ readonly public_id: string }> {
    return this.api.post<{ readonly public_id: string }>(
      `${base}${id(assetId)}/dispose/`,
      disposal,
    );
  }

  /** The disposal's entry; a sale's price is debited to `proceedsAccount`. */
  accountDisposal(disposalId: string, proceedsAccount: string | null): Observable<unknown> {
    return this.api.post<unknown>(
      `${base}disposals/${id(disposalId)}/account/`,
      proceedsAccount ? { proceeds_account: proceedsAccount } : {},
    );
  }

  recordLine(lineId: string): Observable<unknown> {
    return this.api.post<unknown>(`${base}depreciation-lines/${id(lineId)}/record/`);
  }

  accountLine(lineId: string): Observable<unknown> {
    return this.api.post<unknown>(`${base}depreciation-lines/${id(lineId)}/account/`, {});
  }

  schedule(assetId: string): Observable<readonly DepreciationPlan[]> {
    return this.api.get<readonly DepreciationPlan[]>(`${base}${id(assetId)}/schedule/`);
  }

  /** How many depreciation lines remain to post up to a date (their count only). */
  dueCount(until: string): Observable<Paginated<unknown>> {
    return this.api.get<Paginated<unknown>>(`${base}depreciation-lines/`, {
      params: { status: 'planned', date_to: until, page_size: 1 },
    });
  }

  postDue(until: string): Observable<PostedDepreciation> {
    return this.api.post<PostedDepreciation>(`${base}depreciation-lines/post-due/`, { until });
  }
}
