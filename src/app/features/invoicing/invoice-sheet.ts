import { DatePipe, formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  LOCALE_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, catchError, debounceTime, firstValueFrom, map, of } from 'rxjs';

import { serverFieldErrors } from '../../core/errors/field-errors';
import { UserError, toUserError } from '../../core/errors/user-error';
import { ApiError, toApiError } from '../../core/http/api-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../core/navigation/unsaved-changes';
import { SessionStore } from '../../core/session/session.store';
import {
  AlcoAutocomplete,
  AutocompleteOption,
  AutocompleteSearch,
} from '../../shared/forms/autocomplete';
import { AlcoInput } from '../../shared/forms/input';
import { decimalFormat } from '../../shared/forms/validators';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton, ButtonVariant } from '../../shared/ui/button/button';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../shared/ui/icon/icon';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../shared/ui/tabs/tabs';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps, WorkflowStep } from '../../shared/ui/workflow-steps/workflow-steps';
import { localToday } from '../../shared/utils/dates';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { AccountingApi } from '../accounting/data-access/accounting-api';
import { Journal } from '../accounting/data-access/accounting-models';
import { EntryLineRow, EntryLinesApi } from '../accounting/data-access/entry-lines-api';
import { AUDIT_TYPES, AlcoObjectHistory } from '../audit/object-history';
import { ClosingReasonDialogService } from '../closing/reason-dialog';
import { TaxesApi } from '../taxes/data-access/taxes-api';
import { Tax } from '../taxes/data-access/taxes-models';
import { InvoicingApi } from './data-access/invoicing-api';
import {
  Invoice,
  InvoiceKind,
  InvoiceLineWrite,
  InvoiceUpdate,
  InvoiceWrite,
  LineType,
  NamedReference,
  Preview,
  Product,
} from './data-access/invoicing-models';
import {
  ACCOUNTING,
  INVOICING_ERRORS,
  KINDS,
  KindSpec,
  invoiceUrl,
} from './invoicing-presentation';
import { ProductCatalogService } from './product-catalog';

interface LineForm {
  display_type: FormControl<LineType>;
  product: FormControl<string>;
  description: FormControl<string>;
  quantity: FormControl<string>;
  unit_price: FormControl<string>;
  tax: FormControl<string>;
}

type Action = 'confirm' | 'cancel' | 'creditNote' | 'reset';

const ACTIONS: Readonly<Record<Action, { label: string; variant: ButtonVariant }>> = {
  confirm: { label: 'Confirmer', variant: 'primary' },
  cancel: { label: 'Annuler', variant: 'secondary' },
  creditNote: { label: 'Avoir', variant: 'secondary' },
  reset: { label: 'Remettre en brouillon', variant: 'secondary' },
};

/** The word above the number, as in Odoo. */
const KIND_LABELS: Readonly<Record<InvoiceKind, string>> = {
  customer_invoice: 'Facture client',
  customer_credit_note: 'Avoir client',
  supplier_invoice: 'Facture fournisseur',
  supplier_credit_note: 'Avoir fournisseur',
};

/** Business refusals that belong to one field (by their stable code). */
const FIELD_OF_CODE: Readonly<Record<string, [string, string]>> = {
  partner_inactive: ['partner', 'Ce tiers est inactif.'],
  invoicing_journal_kind: ['journal', 'Ce journal ne convient pas à ce côté.'],
  invoicing_invoice_number_year: ['invoice_date', 'Une date de l’année de son numéro.'],
};

/** Codes after which the record is read again: another user changed it meanwhile. */
const STALE = new Set(['invoicing_invoice_not_draft', 'invoicing_invoice_not_posted']);

/** An invoice or a credit note as Odoo shows it: the draft edited in place, then its record (notes backend 0038, 0040, 0041). */
@Component({
  selector: 'alco-invoice-sheet',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    AlcoAmountPipe,
    AlcoAutocomplete,
    AlcoButton,
    AlcoCell,
    AlcoDropdown,
    AlcoErrorState,
    AlcoIcon,
    AlcoInput,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoTabPanel,
    AlcoTabs,
    AlcoTable,
    AlcoWorkflowSteps,
  ],
  templateUrl: './invoice-sheet.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './invoice-sheet.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceSheetPage {
  private readonly api = inject(InvoicingApi);
  private readonly lineApi = inject(EntryLinesApi);
  private readonly accountingApi = inject(AccountingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(AlcoToastService);
  private readonly confirmService = inject(AlcoConfirmService);
  private readonly reasons = inject(ClosingReasonDialogService);
  private readonly catalog = inject(ProductCatalogService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly session = inject(SessionStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly year = String(new Date().getFullYear());
  private readonly countries = new Intl.DisplayNames(['fr'], { type: 'region' });

  protected readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.id === null;
  private readonly kindOfRoute = this.route.snapshot.data['kind'] as InvoiceKind | undefined;
  protected readonly invoice = signal<Invoice | null>(null);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly ready = computed(() => this.isNew || this.invoice() !== null);
  protected readonly kind = computed<InvoiceKind>(
    () => this.invoice()?.kind ?? this.kindOfRoute ?? 'customer_invoice',
  );
  protected readonly spec = computed<KindSpec>(() => KINDS[this.kind()]);
  protected readonly kindLabel = computed(() => KIND_LABELS[this.kind()]);
  protected readonly customerSide = computed(() => this.spec().side === 'customer');
  protected readonly isCreditNote = computed(() => !this.spec().creatable);
  /** A draft is edited in place, as in Odoo; a posted or cancelled document is read only. */
  protected readonly editable = computed(() => {
    const invoice = this.invoice();
    return invoice
      ? invoice.status === 'draft' && this.session.can('invoicing.update')
      : this.isNew && this.session.can('invoicing.create');
  });

  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly invalidSubmit = signal(false);
  protected readonly tab = signal('lines');
  protected readonly accounting = ACCOUNTING;
  protected readonly auditType = AUDIT_TYPES.invoice;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  protected readonly canOpenEntries = computed(() => this.session.can('accounting.read'));
  protected readonly canOpenPartners = computed(() => this.session.can('partners.read'));

  protected readonly form = new FormGroup({
    partner: new FormControl<AutocompleteOption | null>(null, {
      validators: [Validators.required],
    }),
    invoice_date: new FormControl(localToday(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    reference: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(64)] }),
    journal: new FormControl('', { nonNullable: true }),
    lines: new FormArray<FormGroup<LineForm>>([]),
  });
  /** Bumped at each change of the form: the signals below follow it. */
  private readonly changes = signal(0);

  protected readonly products = signal<readonly Product[]>([]);
  private readonly taxes = signal<readonly Tax[]>([]);
  protected readonly journals = signal<readonly Journal[]>([]);
  protected readonly sideTaxes = computed(() => {
    const side = this.customerSide() ? 'sale' : 'purchase';
    return this.taxes().filter(
      (tax) => !tax.withholding && (tax.type_tax_use === side || tax.type_tax_use === 'both'),
    );
  });
  protected readonly searchPartners: AutocompleteSearch = (term) =>
    this.api.partners(term).pipe(
      map((partners) =>
        partners.map((partner) => ({
          id: partner.public_id,
          label: partner.name,
          detail: partner.code,
        })),
      ),
    );

  /** The amounts as typed (the server's rules, nothing stored); by line index. */
  protected readonly preview = signal<Preview | null>(null);
  private readonly previewIndex = signal<ReadonlyMap<number, number>>(new Map());
  private previewCall?: Subscription;

  protected readonly title = computed(() => {
    const invoice = this.invoice();
    if (!invoice) {
      return '';
    }
    return invoice.number
      ? `${this.spec().word} ${invoice.number}`
      : `${this.spec().word} (brouillon)`;
  });
  protected readonly steps = computed<readonly WorkflowStep[]>(() => [
    { id: 'draft', label: 'Brouillon' },
    { id: 'posted', label: 'Comptabilisé' },
    ...(this.invoice()?.status === 'cancelled' ? [{ id: 'cancelled', label: 'Annulé' }] : []),
  ]);
  protected readonly status = computed(() => this.invoice()?.status ?? 'draft');
  protected readonly ribbon = computed(() => {
    const invoice = this.invoice();
    if (invoice?.status !== 'posted') {
      return null;
    }
    if (invoice.payment_state === 'partial') {
      return { label: 'Partiel', tone: 'partial' };
    }
    if (invoice.payment_state !== 'paid') {
      return null;
    }
    const reversed =
      invoice.settlements.length > 0 && invoice.settlements.every((item) => item.credit_note);
    return reversed ? { label: 'Extourné', tone: 'reversed' } : { label: 'Payé', tone: 'paid' };
  });
  protected readonly newUrl = computed(() =>
    this.spec().creatable && this.session.can('invoicing.create')
      ? `${ACCOUNTING}/${this.spec().path}/nouvelle`
      : null,
  );
  protected readonly originUrl = computed(() => {
    const invoice = this.invoice();
    if (!invoice?.origin) {
      return null;
    }
    const kind = invoice.kind === 'customer_credit_note' ? 'customer_invoice' : 'supplier_invoice';
    return invoiceUrl(kind, invoice.origin);
  });
  /** The partner's address, once it is the document's partner. */
  protected readonly address = computed(() => {
    this.changes();
    const partner = this.invoice()?.partner;
    if (!partner || this.form.controls.partner.value?.id !== partner.public_id) {
      return [];
    }
    return [
      partner.phone,
      ...partner.address.split('\n'),
      partner.city,
      partner.country ? (this.countries.of(partner.country) ?? partner.country) : '',
    ]
      .map((item) => item.trim())
      .filter(Boolean);
  });
  protected readonly tabs = computed<readonly TabItem[]>(() => [
    { id: 'lines', label: this.isCreditNote() ? 'Lignes d’avoir' : 'Lignes de facture' },
    ...(this.canOpenEntries() && (this.editable() || this.invoice()?.entry)
      ? [{ id: 'entries', label: 'Écritures comptables' }]
      : []),
    { id: 'other', label: 'Autres informations' },
  ]);

  /** The totals: as typed on a draft, the server's once posted. */
  protected readonly totals = computed(() => {
    this.changes();
    const invoice = this.invoice();
    const preview = this.preview();
    const source =
      this.editable() && preview
        ? {
            untaxed: preview.amount_untaxed,
            taxes: preview.taxes.map((item) => ({ name: item.tax.name, amount: item.amount })),
            total: preview.amount_total,
          }
        : invoice
          ? {
              untaxed: invoice.amount_untaxed,
              taxes: invoice.taxes.map((item) => ({ name: item.tax.name, amount: item.amount })),
              total: invoice.amount_total,
            }
          : { untaxed: '0', taxes: [], total: '0' };
    const due = invoice?.amount_residual ?? (invoice?.status === 'cancelled' ? null : source.total);
    return { ...source, due };
  });

  /** The commands the state and the permissions allow, as Odoo's buttons; the server decides. */
  protected readonly actions = computed<
    readonly { id: Action; label: string; variant: ButtonVariant }[]
  >(() => {
    const invoice = this.invoice();
    const can = (permission: string) => this.session.can(permission);
    const ids: Action[] = [];
    if (this.editable()) {
      if (can('invoicing.post')) {
        ids.push('confirm');
      }
      if (this.isNew || can('invoicing.cancel')) {
        ids.push('cancel');
      }
    } else if (invoice?.status === 'posted') {
      if (this.spec().creatable && can('invoicing.create')) {
        ids.push('creditNote');
      }
      if (can('invoicing.cancel')) {
        ids.push('reset');
      }
    }
    return ids.map((id) => ({ id, ...ACTIONS[id] }));
  });
  /** ⚙ next to « Nouveau »: a draft without number is deleted from there, as in Odoo. */
  protected readonly gear = computed<readonly DropdownItem[]>(() => {
    const invoice = this.invoice();
    return invoice?.status === 'draft' && !invoice.number && this.session.can('invoicing.update')
      ? [{ id: 'remove', label: 'Supprimer', icon: 'trash', danger: true }]
      : [];
  });

  protected readonly entryLines = requestState(
    () => this.lineApi.lines({ entry: untracked(this.invoice)?.entry?.public_id, state: 'all' }),
    { immediate: false },
  );
  protected readonly entryColumns: readonly TableColumn[] = [
    { key: 'account', label: 'Compte' },
    { key: 'partner', label: 'Partenaire', hideBelow: 'tablet' },
    { key: 'label', label: 'Libellé', hideBelow: 'laptop' },
    { key: 'debit', label: 'Débit', width: '10rem', numeric: true },
    { key: 'credit', label: 'Crédit', width: '10rem', numeric: true },
  ];
  protected readonly entryLineId = (row: EntryLineRow) => row.public_id;
  protected readonly entryLineLabel = (row: EntryLineRow) => row.account.code;
  protected readonly previewEntryId = (row: { account: NamedReference; label: string }) =>
    `${row.account.code}-${row.label}`;
  protected readonly previewEntryLabel = (row: { account: NamedReference }) => row.account.code;

  constructor() {
    inject(UnsavedChangesService).track(() => this.editable() && this.form.dirty);
    this.api
      .productOptions()
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Product[])),
      )
      .subscribe((list) => this.products.set(list));
    inject(TaxesApi)
      .taxes({ status: 'active' })
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Tax[])),
      )
      .subscribe((list) => this.taxes.set(list));
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.changes.update((n) => n + 1));
    this.form.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.refreshPreview());
    if (this.id) {
      this.load(this.id);
    } else {
      // As in Odoo, a new document starts without line.
      this.loadJournals(this.spec());
      this.form.markAsPristine();
      afterNextRender(() => this.focus('partner'), { injector: this.injector });
    }
    effect(() => {
      const title = this.title();
      if (title) {
        untracked(() => this.breadcrumbs.nameCurrent(title));
      }
    });
    effect(() => {
      if (this.tab() === 'entries' && this.invoice()?.entry && !this.editable()) {
        untracked(() => this.entryLines.reload());
      }
    });
    effect(() => {
      if (!this.tabs().some((item) => item.id === this.tab())) {
        this.tab.set('lines');
      }
    });
  }

  protected get lines(): FormArray<FormGroup<LineForm>> {
    return this.form.controls.lines;
  }

  // ---- Reading -------------------------------------------------------------------------

  /** « 10 oct. » this year, « 10 oct. 2025 » before, as in Odoo. */
  protected shortDate(value: string): string {
    return formatDate(value, value.startsWith(this.year) ? 'd MMM' : 'd MMM y', this.locale);
  }

  protected productOf(index: number): Product | undefined {
    const id = this.lines.at(index)?.controls.product.value;
    return this.products().find((item) => item.public_id === id);
  }

  /** The account of a line: posted, else the product's for the side. */
  protected accountOf(index: number): NamedReference | null {
    const saved = this.invoice()?.lines[index];
    const product = this.productOf(index);
    if (product) {
      return this.customerSide() ? product.sale_account : product.purchase_account;
    }
    return saved?.account ?? null;
  }

  protected unitOf(index: number): string {
    return this.productOf(index)?.unit ?? this.invoice()?.lines[index]?.unit ?? '';
  }

  /** « Montant » of a line: as typed on a draft. */
  protected amountOf(index: number): string | null {
    this.changes();
    const preview = this.preview();
    if (preview) {
      const at = this.previewIndex().get(index);
      return at === undefined ? null : (preview.lines[at]?.amount_untaxed ?? null);
    }
    return this.invoice()?.lines[index]?.amount_untaxed ?? null;
  }

  protected productUrl(productId: string): string {
    return `${ACCOUNTING}/produits/${productId}`;
  }

  protected creditNoteUrl(kind: InvoiceKind, noteId: string): string {
    return invoiceUrl(kind, noteId);
  }

  // ---- Lines ---------------------------------------------------------------------------

  protected addLine(type: LineType = 'product', focus = true): void {
    this.lines.push(this.line({ display_type: type }));
    this.form.markAsDirty();
    if (focus) {
      const index = this.lines.length - 1;
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>(
              `[data-line="${index}"] select, [data-line="${index}"] input`,
            )
            ?.focus(),
        { injector: this.injector },
      );
    }
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.form.markAsDirty();
  }

  /** A product chosen: its price (customer documents) and its tax, as proposals. */
  protected productChosen(index: number): void {
    const line = this.lines.at(index);
    const product = this.productOf(index);
    if (!product) {
      return;
    }
    if (this.customerSide() && product.sale_price !== null && !line.controls.unit_price.value) {
      line.controls.unit_price.setValue(trimDecimalZeros(product.sale_price, 0));
    }
    if (this.sideTaxes().some((tax) => tax.public_id === product.tax.public_id)) {
      line.controls.tax.setValue(product.tax.public_id);
    }
  }

  /** The active products, with a line's own product if it was retired since. */
  protected productChoices(current: string): readonly { id: string; label: string }[] {
    const choices = this.products().map((product) => ({
      id: product.public_id,
      label: product.code ? `${product.code} — ${product.name}` : product.name,
    }));
    const own = this.invoice()?.lines.find((line) => line.product?.public_id === current)?.product;
    return own && !choices.some((choice) => choice.id === current)
      ? [...choices, { id: own.public_id, label: own.name }]
      : choices;
  }

  /** « Catalogue »: quantities chosen in a grid of products, as in Odoo. */
  protected async openCatalog(): Promise<void> {
    const quantities = new Map<string, number>();
    for (const line of this.lines.controls) {
      const value = line.getRawValue();
      if (value.display_type === 'product' && value.product) {
        quantities.set(
          value.product,
          (quantities.get(value.product) ?? 0) +
            (Number(normalizeDecimalInput(value.quantity)) || 0),
        );
      }
    }
    const chosen = await this.catalog.open({
      products: this.products(),
      quantities,
      customer: this.customerSide(),
    });
    for (const [productId, quantity] of chosen) {
      if (quantity === (quantities.get(productId) ?? 0)) {
        continue;
      }
      const indexes = this.lines.controls
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.controls.product.value === productId);
      if (quantity === 0) {
        for (const { index } of indexes.reverse()) {
          this.lines.removeAt(index);
        }
      } else if (indexes.length > 0) {
        indexes[0].line.controls.quantity.setValue(String(quantity));
        for (const { index } of indexes.slice(1).reverse()) {
          this.lines.removeAt(index);
        }
      } else {
        // An empty product line is taken first, as in Odoo.
        const empty = this.lines.controls.findIndex(
          (line) => line.controls.display_type.value === 'product' && !line.controls.product.value,
        );
        if (empty >= 0) {
          this.lines.removeAt(empty);
        }
        this.lines.push(this.line({ product: productId, quantity: String(quantity) }));
        this.productChosen(this.lines.length - 1);
      }
    }
    this.form.markAsDirty();
  }

  // ---- Actions -------------------------------------------------------------------------

  protected onGear(item: DropdownItem): void {
    if (item.id === 'remove') {
      void this.remove();
    }
  }

  protected async act(action: Action): Promise<void> {
    switch (action) {
      case 'confirm':
        return this.confirm();
      case 'cancel':
        return this.isNew ? this.discard() : this.cancelDocument();
      case 'creditNote':
        return this.creditNote();
      case 'reset':
        return this.reset();
    }
  }

  /** ☁ « Enregistrer »: the draft as typed. */
  protected async save(): Promise<void> {
    const saved = await this.store();
    if (saved && this.isNew) {
      await this.router.navigateByUrl(invoiceUrl(saved.kind, saved.public_id), {
        replaceUrl: true,
      });
    }
  }

  /** « Ignorer les modifications »: the draft as saved; a new one is left. */
  protected async discard(): Promise<void> {
    if (this.isNew) {
      this.form.markAsPristine();
      await this.router.navigateByUrl(`${ACCOUNTING}/${this.spec().path}`);
      return;
    }
    const invoice = this.invoice();
    if (invoice) {
      this.fill(invoice);
    }
  }

  /** « Confirmer »: saved if need be, then posted (the number and the entry). */
  protected async confirm(): Promise<void> {
    if (!this.validate()) {
      return;
    }
    const spec = this.spec();
    const number = this.invoice()?.number;
    const ok = await this.confirmService.confirm({
      title: `Confirmer ${spec.word.toLowerCase()} ?`,
      message:
        (number ? `Il garde son numéro ${number}. ` : 'Le serveur lui donne son numéro. ') +
        'Son écriture est créée dans son journal, validée tout de suite. Pour la corriger ' +
        'ensuite : un avoir, ou « Remettre en brouillon ».',
      confirmLabel: 'Confirmer',
    });
    if (!ok) {
      return;
    }
    const saved = this.form.dirty || this.isNew ? await this.store() : this.invoice();
    if (!saved) {
      return;
    }
    this.busy.set(true);
    try {
      const posted = await firstValueFrom(this.api.post(saved.public_id));
      this.toast.success(
        `${spec.word} ${posted.number} comptabilisée : écriture ${posted.entry?.entry_number ?? ''}.`,
      );
      if (this.isNew) {
        await this.router.navigateByUrl(invoiceUrl(posted.kind, posted.public_id), {
          replaceUrl: true,
        });
      } else {
        this.load(saved.public_id);
      }
    } catch (failure) {
      this.fail(failure);
      if (this.isNew) {
        await this.router.navigateByUrl(invoiceUrl(saved.kind, saved.public_id), {
          replaceUrl: true,
        });
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async remove(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) {
      return;
    }
    const ok = await this.confirmService.confirm({
      title: 'Supprimer ce brouillon ?',
      message: 'Il n’a pas de numéro : sa suppression ne laisse pas de trou.',
      confirmLabel: 'Supprimer le brouillon',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    await this.run(async () => {
      await firstValueFrom(this.api.deleteInvoice(invoice.public_id));
      this.form.markAsPristine();
      this.toast.success('Brouillon supprimé.');
      await this.router.navigateByUrl(`${ACCOUNTING}/${this.spec().path}`);
    });
  }

  private async cancelDocument(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) {
      return;
    }
    const word = this.spec().word.toLowerCase();
    const reason = await this.reasons.ask({
      title: `Annuler ${word}${invoice.number ? ' ' + invoice.number : ''} ?`,
      message: 'Le document reste, annulé ; il n’a pas d’écriture à extourner.',
      confirmLabel: 'Annuler le document',
      tone: 'danger',
      hint: 'Gardé dans l’historique du document.',
    });
    if (reason) {
      await this.run(async () => {
        await firstValueFrom(this.api.cancel(invoice.public_id, reason));
        this.form.markAsPristine();
        this.toast.success(`${this.spec().word} annulée.`);
        this.load(invoice.public_id);
      });
    }
  }

  private async creditNote(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) {
      return;
    }
    await this.run(async () => {
      const note = await firstValueFrom(this.api.creditNote(invoice.public_id));
      this.toast.success('Avoir créé en brouillon : ajustez ses lignes, puis confirmez-le.');
      await this.router.navigateByUrl(invoiceUrl(note.kind, note.public_id));
    });
  }

  private async reset(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) {
      return;
    }
    const word = this.spec().word;
    const ok = await this.confirmService.confirm({
      title: `Remettre ${word.toLowerCase()} ${invoice.number} en brouillon ?`,
      message:
        `Son écriture ${invoice.entry?.entry_number ?? ''} est extournée aujourd’hui. Le document ` +
        'redevient modifiable et garde son numéro ; confirmez-le à nouveau ensuite. Seul un ' +
        'document sans règlement ni avoir se remet en brouillon.',
      confirmLabel: 'Remettre en brouillon',
    });
    if (ok) {
      await this.run(async () => {
        const saved = await firstValueFrom(this.api.resetToDraft(invoice.public_id));
        this.toast.success(`${word} ${saved.number} remise en brouillon.`);
        this.load(invoice.public_id);
      });
    }
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await work();
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.busy.set(false);
    }
  }

  private fail(failure: unknown): void {
    const error = toUserError(failure, INVOICING_ERRORS);
    this.actionError.set(error);
    const id = this.invoice()?.public_id;
    if (STALE.has(error.code) && id) {
      this.load(id);
    }
  }

  // ---- Saving --------------------------------------------------------------------------

  private validate(): boolean {
    this.actionError.set(null);
    this.form.markAllAsTouched();
    const sold = this.lines.controls.some((line) => line.controls.display_type.value === 'product');
    if (this.form.invalid || !sold) {
      this.invalidSubmit.set(true);
      this.focusFirstInvalid();
      return false;
    }
    this.invalidSubmit.set(false);
    return true;
  }

  /** The draft created or changed; null when refused (said on the screen). */
  private async store(): Promise<Invoice | null> {
    if (this.busy() || !this.validate()) {
      return null;
    }
    const invoice = this.invoice();
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        invoice
          ? this.api.updateInvoice(invoice.public_id, this.update())
          : this.api.createInvoice(this.creation()),
      );
      this.toast.success(invoice ? 'Modifications enregistrées.' : 'Brouillon enregistré.');
      this.form.markAsPristine();
      if (invoice) {
        this.fill(saved);
      }
      return saved;
    } catch (failure) {
      this.showFailure(toApiError(failure));
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private line(values?: Partial<Record<keyof LineForm, string>>): FormGroup<LineForm> {
    const type = (values?.display_type ?? 'product') as LineType;
    const product = type === 'product';
    return new FormGroup<LineForm>({
      display_type: new FormControl<LineType>(type, { nonNullable: true }),
      product: new FormControl(values?.product ?? '', {
        nonNullable: true,
        validators: product ? [Validators.required] : [],
      }),
      description: new FormControl(values?.description ?? '', {
        nonNullable: true,
        validators: product
          ? [Validators.maxLength(255)]
          : [Validators.required, Validators.maxLength(255)],
      }),
      quantity: new FormControl(values?.quantity ?? '1', {
        nonNullable: true,
        validators: product ? [Validators.required, decimalFormat(4)] : [],
      }),
      unit_price: new FormControl(values?.unit_price ?? '', {
        nonNullable: true,
        validators: !product
          ? []
          : this.customerSide()
            ? [decimalFormat(6)]
            : [Validators.required, decimalFormat(6)],
      }),
      tax: new FormControl(values?.tax ?? '', { nonNullable: true }),
    });
  }

  private written(line: FormGroup<LineForm>): InvoiceLineWrite {
    const value = line.getRawValue();
    if (value.display_type !== 'product') {
      return { display_type: value.display_type, description: value.description.trim() };
    }
    const price = value.unit_price.trim();
    return {
      product: value.product,
      quantity: normalizeDecimalInput(value.quantity) ?? value.quantity,
      unit_price: price ? (normalizeDecimalInput(price) ?? price) : null,
      description: value.description.trim(),
      tax: value.tax || null,
    };
  }

  private creation(): InvoiceWrite {
    const value = this.form.getRawValue();
    return {
      kind: this.spec().kind as InvoiceWrite['kind'],
      partner: value.partner?.id ?? '',
      invoice_date: value.invoice_date,
      journal: value.journal || null,
      reference: value.reference.trim(),
      lines: this.lines.controls.map((line) => this.written(line)),
    };
  }

  /** The whole draft again: the lines given replace them all. */
  private update(): InvoiceUpdate {
    const value = this.form.getRawValue();
    return {
      ...(this.isCreditNote() ? {} : { partner: value.partner?.id ?? '' }),
      invoice_date: value.invoice_date,
      ...(value.journal ? { journal: value.journal } : {}),
      reference: value.reference.trim(),
      lines: this.lines.controls.map((line) => this.written(line)),
    };
  }

  /** The amounts as typed, for the lines complete enough; the others wait. */
  private refreshPreview(): void {
    if (!this.editable() || this.form.pristine) {
      return;
    }
    const index = new Map<number, number>();
    const lines: InvoiceLineWrite[] = [];
    this.lines.controls.forEach((line, at) => {
      const value = line.getRawValue();
      const ready =
        value.display_type === 'product'
          ? !!value.product && line.controls.quantity.valid && line.controls.unit_price.valid
          : !!value.description.trim();
      if (ready) {
        index.set(at, lines.length);
        lines.push(this.written(line));
      }
    });
    this.previewCall?.unsubscribe();
    this.previewCall = this.api
      .preview({ kind: this.kind(), partner: this.form.controls.partner.value?.id ?? null, lines })
      .subscribe({
        next: (preview) => {
          this.previewIndex.set(index);
          this.preview.set(preview);
        },
        error: () => undefined,
      });
  }

  private load(id: string): void {
    this.api.invoice(id).subscribe({
      next: (invoice) => {
        this.fill(invoice);
        this.loadJournals(KINDS[invoice.kind]);
      },
      error: (failure: unknown) => this.loadError.set(toUserError(failure, INVOICING_ERRORS)),
    });
  }

  private loadJournals(spec: KindSpec): void {
    this.accountingApi
      .journals({
        status: 'active',
        journalType: spec.side === 'customer' ? 'sales' : 'purchase',
      })
      .pipe(
        map((page) => page.results),
        catchError(() => of([] as Journal[])),
      )
      .subscribe((list) => this.journals.set(list));
  }

  private fill(invoice: Invoice): void {
    this.invoice.set(invoice);
    this.preview.set(null);
    this.form.controls.partner.setValue({
      id: invoice.partner.public_id,
      label: invoice.partner.name,
      detail: invoice.partner.code,
    });
    if (this.isCreditNote() || invoice.status !== 'draft') {
      this.form.controls.partner.disable();
    } else {
      this.form.controls.partner.enable();
    }
    this.form.controls.invoice_date.setValue(invoice.invoice_date);
    this.form.controls.reference.setValue(invoice.reference);
    this.form.controls.journal.setValue(invoice.journal.public_id);
    this.lines.clear();
    for (const line of invoice.lines) {
      this.lines.push(
        this.line({
          display_type: line.display_type,
          product: line.product?.public_id ?? '',
          description:
            line.display_type === 'product' && line.description === line.product?.name
              ? ''
              : line.description,
          quantity: trimDecimalZeros(line.quantity, 0),
          unit_price: trimDecimalZeros(line.unit_price, 0),
          tax: line.tax?.public_id ?? '',
        }),
      );
    }
    this.form.markAsPristine();
    this.changes.update((n) => n + 1);
  }

  private showFailure(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const fields: Record<string, string> = { ...serverFieldErrors(error) };
    const business = error.code ? FIELD_OF_CODE[error.code] : undefined;
    if (business) {
      fields[business[0]] = business[1];
    }
    const names = Object.keys(fields).filter((name) => name !== 'lines' && this.form.get(name));
    for (const name of names) {
      this.form.get(name)?.setErrors({ server: fields[name] });
    }
    if (names.length > 0) {
      this.invalidSubmit.set(true);
      this.focus(names[0]);
      return;
    }
    this.actionError.set(toUserError(error, INVOICING_ERRORS));
  }

  private focusFirstInvalid(): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(
        'input.ng-invalid, select.ng-invalid, alco-autocomplete.ng-invalid input',
      )
      ?.focus();
  }

  private focus(name: string): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(
        `[formControlName="${name}"] input, input[formControlName="${name}"], select[formControlName="${name}"]`,
      )
      ?.focus();
  }
}
