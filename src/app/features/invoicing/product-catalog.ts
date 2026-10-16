import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';
import { Product } from './data-access/invoicing-models';

export interface CatalogData {
  readonly products: readonly Product[];
  /** The quantity of each product already on the document, by its public id. */
  readonly quantities: ReadonlyMap<string, number>;
  /** A customer document shows the sale prices. */
  readonly customer: boolean;
}

const TITLE_ID = 'alco-catalog-title';

/** « Catalogue » as in Odoo: the products in a grid, a quantity for each (note backend 0041). */
@Component({
  selector: 'alco-product-catalog',
  imports: [AlcoAmountPipe, AlcoButton, AlcoModal],
  template: `
    <alco-modal title="Catalogue" [titleId]="titleId" (closed)="done()">
      <input
        class="alco-control search"
        type="search"
        aria-label="Rechercher un produit"
        placeholder="Rechercher un produit…"
        data-autofocus
        [value]="term()"
        (input)="term.set($any($event.target).value)"
      />
      @if (shown().length === 0) {
        <p class="alco-caption">Aucun produit actif ne correspond.</p>
      }
      <ul class="grid" aria-label="Produits">
        @for (product of shown(); track product.public_id) {
          @let quantity = quantities().get(product.public_id) ?? 0;
          <li class="card" [class.chosen]="quantity > 0">
            <span class="name">{{ product.name }}</span>
            @if (product.code) {
              <span class="alco-caption">{{ product.code }}</span>
            }
            <span class="price">
              @if (data.customer && product.sale_price !== null) {
                {{ product.sale_price | alcoAmount: 0 }}
              }
              @let unit = data.customer ? product.sale_unit : product.purchase_unit;
              @if (unit) {
                <span class="alco-caption">/ {{ unit.name }}</span>
              }
            </span>
            @if (quantity > 0) {
              <span class="stepper" role="group" [attr.aria-label]="'Quantité de ' + product.name">
                <button
                  alcoButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  [attr.aria-label]="'Retirer un ' + product.name"
                  (click)="change(product, -1)"
                >
                  −
                </button>
                <span class="quantity">{{ quantity }}</span>
                <button
                  alcoButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  [attr.aria-label]="'Ajouter un ' + product.name"
                  (click)="change(product, 1)"
                >
                  +
                </button>
              </span>
            } @else {
              <button
                alcoButton
                type="button"
                size="sm"
                icon="plus"
                [attr.aria-label]="'Ajouter ' + product.name"
                (click)="change(product, 1)"
              >
                Ajouter
              </button>
            }
          </li>
        }
      </ul>
      <div alcoModalFooter>
        <button alcoButton type="button" variant="primary" (click)="done()">
          Retour au document
        </button>
      </div>
    </alco-modal>
  `,
  styles: `
    alco-modal {
      width: min(880px, 100%);
    }
    .search {
      width: 100%;
      margin-bottom: var(--space-3);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
      gap: var(--space-3);
      max-height: min(60vh, 32rem);
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      padding: var(--space-3);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .card.chosen {
      border-color: var(--color-primary);
      background: var(--color-primary-soft);
    }
    .name {
      font-weight: var(--font-weight-semibold);
    }
    .price {
      flex: 1;
      font-variant-numeric: tabular-nums;
    }
    .stepper {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .quantity {
      min-width: 2ch;
      font-weight: var(--font-weight-semibold);
      text-align: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoProductCatalog {
  protected readonly data = inject<CatalogData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<ReadonlyMap<string, number>>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly term = signal('');
  protected readonly quantities = signal<ReadonlyMap<string, number>>(
    new Map(this.data.quantities),
  );
  protected readonly shown = computed(() => {
    const term = this.term().trim().toLowerCase();
    return this.data.products.filter(
      (product) => !term || `${product.code} ${product.name}`.toLowerCase().includes(term),
    );
  });

  protected change(product: Product, step: number): void {
    const next = new Map(this.quantities());
    next.set(product.public_id, Math.max(0, (next.get(product.public_id) ?? 0) + step));
    this.quantities.set(next);
  }

  protected done(): void {
    this.ref.close(this.quantities());
  }
}

/** Opens the catalogue; resolves the quantities chosen, product by product. */
@Injectable({ providedIn: 'root' })
export class ProductCatalogService {
  private readonly dialog = inject(Dialog);

  open(data: CatalogData): Promise<ReadonlyMap<string, number>> {
    const ref = this.dialog.open<ReadonlyMap<string, number>, CatalogData>(AlcoProductCatalog, {
      data,
      ariaLabelledBy: TITLE_ID,
      backdropClass: 'alco-dialog-backdrop',
      panelClass: 'alco-dialog-panel',
      autoFocus: '[data-autofocus]',
      restoreFocus: true,
    });
    return firstValueFrom(ref.closed).then((result) => result ?? data.quantities);
  }
}
