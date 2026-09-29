import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoSearchBar } from '../../../shared/filters/search-bar';
import { AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { PARTNERS } from '../accounting/prototype-data';
import { Partner } from '../accounting/prototype-models';
import { AlcoTransferActions } from '../transfers/transfer-actions';

type Role = 'all' | 'customer' | 'supplier';

interface PartnerRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly country: string;
  readonly city: string;
}

function toRow(partner: Partner): PartnerRow {
  return {
    id: partner.id,
    code: partner.code,
    name: partner.name,
    role: [partner.customer ? 'Client' : '', partner.supplier ? 'Fournisseur' : '']
      .filter(Boolean)
      .join(', '),
    country: partner.country,
    city: partner.city,
  };
}

/**
 * PROTOTYPE — Tiers › list of partners (fictitious). Shows where the partner import and
 * export live: in this domain's « Actions ▾ », exactly for partners.
 */
@Component({
  selector: 'alco-partner-list',
  imports: [
    RouterLink,
    AlcoButton,
    AlcoEmptyState,
    AlcoPageHeader,
    AlcoSearchBar,
    AlcoTable,
    AlcoTransferActions,
  ],
  template: `
    <alco-page-header [title]="title()">
      <div alcoPageActions>
        <alco-transfer-actions kind="partners" [count]="rows().length" />
        @if (session.can('partners.create')) {
          <a alcoButton variant="primary" icon="plus" routerLink="/tiers/nouveau">Nouveau tiers</a>
        }
      </div>
    </alco-page-header>

    <alco-search-bar
      label="Rechercher un tiers"
      placeholder="Rechercher par code, nom ou ville…"
      [(query)]="query"
    />

    @if (rows().length > 0) {
      <alco-table
        caption="Tiers (données fictives)"
        [columns]="columns"
        [rows]="rows()"
        [rowId]="rowId"
        [rowLabel]="rowLabel"
      />
    } @else {
      <div class="empty-frame">
        <alco-empty-state
          icon="search"
          title="Aucun tiers ne correspond à cette recherche."
          message="Vérifiez l’orthographe ou cherchez par code."
        />
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      min-width: 0;
    }
    alco-search-bar {
      max-width: 560px;
    }
    .empty-frame {
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartnerListPage {
  protected readonly session = inject(SessionStore);
  private readonly trail = inject(BreadcrumbService).items;
  private readonly role = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => (data['role'] as Role | undefined) ?? 'all')),
    { initialValue: 'all' as Role },
  );

  protected readonly query = signal('');
  protected readonly title = computed(() => this.trail().at(-1)?.label ?? 'Tiers');
  protected readonly columns: readonly TableColumn[] = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Nom' },
    { key: 'role', label: 'Rôle' },
    { key: 'country', label: 'Pays', hideBelow: 'tablet' },
    { key: 'city', label: 'Ville', hideBelow: 'tablet' },
  ];
  protected readonly rowId = (row: PartnerRow) => row.id;
  protected readonly rowLabel = (row: PartnerRow) => row.name;

  protected readonly rows = computed(() => {
    const role = this.role();
    const query = this.query().trim().toLowerCase();
    return PARTNERS.filter(
      (partner) =>
        (role === 'all' || (role === 'customer' ? partner.customer : partner.supplier)) &&
        (!query ||
          [partner.code, partner.name, partner.city].some((text) =>
            text.toLowerCase().includes(query),
          )),
    ).map(toRow);
  });
}
