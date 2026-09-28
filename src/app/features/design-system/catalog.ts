import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { AlcoTopbar } from '../../core/layout/topbar/topbar';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { decimalFormat } from '../../shared/forms/validators';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge, BadgeStatus, STATUS_PRESENTATION } from '../../shared/ui/badge/badge';
import { AlcoBreadcrumb } from '../../shared/ui/breadcrumb/breadcrumb';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../shared/ui/dropdown/dropdown';
import { AlcoEmptyState } from '../../shared/ui/empty-state/empty-state';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoTabPanel, AlcoTabs } from '../../shared/ui/tabs/tabs';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps } from '../../shared/ui/workflow-steps/workflow-steps';

interface Swatch {
  readonly token: string;
  readonly role: string;
}

const SWATCHES: readonly { group: string; items: readonly Swatch[] }[] = [
  {
    group: 'Identité et texte',
    items: [
      { token: '--color-primary', role: 'Action principale, liens, sélection' },
      { token: '--color-brand-night', role: 'Barre supérieure' },
      { token: '--color-brand-accent', role: 'Accent du logo, compteur' },
      { token: '--color-text', role: 'Texte' },
      { token: '--color-text-muted', role: 'Texte secondaire' },
      { token: '--color-bg', role: 'Fond de page' },
      { token: '--color-surface', role: 'Surfaces (cartes, tableaux)' },
      { token: '--color-border', role: 'Bordures' },
    ],
  },
  {
    group: 'États',
    items: [
      { token: '--color-success', role: 'Validé, réussite' },
      { token: '--color-warning', role: 'En attente, avertissement' },
      { token: '--color-danger', role: 'Erreur, bloqué, suppression' },
      { token: '--color-info', role: 'Information' },
      { token: '--color-neutral', role: 'Brouillon, annulé' },
    ],
  },
  {
    group: 'Familles d’applications',
    items: [
      { token: '--app-family-finance', role: 'Comptabilité, Taxes, Analytique' },
      { token: '--app-family-flows', role: 'Trésorerie, Emprunts' },
      { token: '--app-family-relations', role: 'Tiers, Documents' },
      { token: '--app-family-steering', role: 'Immobilisations, Reporting, Tableau de bord' },
      { token: '--app-family-control', role: 'Audit, Imports / Exports, Paramètres' },
    ],
  },
];

interface SampleRow {
  readonly account: string;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
}

/**
 * Living catalogue of the design system: tokens, components and every screen state
 * (loading, empty, error, feedback). Used for the visual review; never shows business data.
 */
@Component({
  selector: 'alco-design-system-catalog',
  imports: [
    ReactiveFormsModule,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoBreadcrumb,
    AlcoButton,
    AlcoCard,
    AlcoDropdown,
    AlcoEmptyState,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
    AlcoTabPanel,
    AlcoTabs,
    AlcoTopbar,
    AlcoWorkflowSteps,
  ],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesignSystemCatalogPage {
  private readonly toast = inject(AlcoToastService);
  private readonly confirmService = inject(AlcoConfirmService);

  protected readonly swatches = SWATCHES;
  protected readonly statuses = Object.keys(STATUS_PRESENTATION) as BadgeStatus[];
  protected readonly tab = signal('first');
  protected readonly confirmResult = signal('');
  protected readonly busy = signal(false);

  protected readonly requiredField = new FormControl('', {
    nonNullable: true,
    validators: Validators.required,
  });
  protected readonly amountField = new FormControl('12,555', {
    nonNullable: true,
    validators: decimalFormat(0),
  });

  protected readonly actionItems: readonly DropdownItem[] = [
    { id: 'duplicate', label: 'Dupliquer', icon: 'copy' },
    { id: 'export', label: 'Exporter', icon: 'download' },
    { id: 'delete', label: 'Supprimer', icon: 'trash', danger: true, dividerBefore: true },
  ];

  protected readonly columns: readonly TableColumn[] = [
    { key: 'account', label: 'Compte' },
    { key: 'label', label: 'Libellé' },
    { key: 'debit', label: 'Débit (GNF)', numeric: true },
    { key: 'credit', label: 'Crédit (GNF)', numeric: true },
  ];
  protected readonly rows: readonly SampleRow[] = [
    { account: '601100', label: 'Exemple d’achat', debit: '1250000', credit: '' },
    { account: '445200', label: 'TVA récupérable 18 %', debit: '225000', credit: '' },
    { account: '401100', label: 'Exemple de fournisseur', debit: '', credit: '1475000' },
  ];
  protected readonly rowId = (row: SampleRow) => row.account;

  constructor() {
    this.requiredField.markAsTouched();
    this.amountField.markAsTouched();
  }

  protected showToast(tone: 'success' | 'warning' | 'danger' | 'info'): void {
    const messages = {
      success: 'Brouillon enregistré.',
      info: 'Société active : ALCO DÉMO SARL.',
      warning: '2 écritures validées, 1 refusée (ouvrez-la pour voir pourquoi).',
      danger: 'Le serveur ne répond pas. Vérifiez votre connexion.',
    };
    this.toast.show(tone, messages[tone]);
  }

  protected async confirm(tone: 'primary' | 'danger'): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      tone === 'danger'
        ? {
            title: 'Supprimer ce brouillon ?',
            message: 'Le brouillon et ses lignes seront définitivement supprimés.',
            confirmLabel: 'Supprimer le brouillon',
            tone: 'danger',
          }
        : {
            title: 'Valider cette écriture ?',
            message:
              'Une écriture validée ne peut plus être modifiée ; elle pourra être contrepassée.',
            confirmLabel: 'Valider l’écriture',
          },
    );
    this.confirmResult.set(confirmed ? 'Action confirmée.' : 'Action annulée.');
  }

  protected simulateBusy(): void {
    this.busy.set(true);
    setTimeout(() => this.busy.set(false), 1500);
  }
}
