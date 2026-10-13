import { DatePipe, formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { SessionStore } from '../../core/session/session.store';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoButton, ButtonVariant } from '../../shared/ui/button/button';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../shared/ui/icon/icon';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoTabPanel, AlcoTabs, TabItem } from '../../shared/ui/tabs/tabs';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps, WorkflowStep } from '../../shared/ui/workflow-steps/workflow-steps';
import { EntryLineRow, EntryLinesApi } from '../accounting/data-access/entry-lines-api';
import { AUDIT_TYPES, AlcoObjectHistory } from '../audit/object-history';
import { ClosingReasonDialogService } from '../closing/reason-dialog';
import { InvoicingApi } from './data-access/invoicing-api';
import { Invoice, InvoiceKind, InvoiceLine } from './data-access/invoicing-models';
import { ACCOUNTING, INVOICING_ERRORS, KINDS, invoiceUrl } from './invoicing-presentation';

type Action = 'post' | 'edit' | 'remove' | 'cancel' | 'creditNote' | 'reset';

const ACTIONS: Readonly<Record<Action, { label: string; variant: ButtonVariant }>> = {
  post: { label: 'Comptabiliser', variant: 'primary' },
  edit: { label: 'Modifier', variant: 'secondary' },
  remove: { label: 'Supprimer', variant: 'secondary' },
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

/** Codes after which the record is read again: another user changed it meanwhile. */
const STALE = new Set(['invoicing_invoice_not_draft', 'invoicing_invoice_not_posted']);

/** The record of an invoice or a credit note, laid out as Odoo's (notes backend 0038, 0040). */
@Component({
  selector: 'alco-invoice-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoButton,
    AlcoCell,
    AlcoErrorState,
    AlcoIcon,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoTabPanel,
    AlcoTabs,
    AlcoTable,
    AlcoWorkflowSteps,
  ],
  templateUrl: './invoice-detail.html',
  styleUrls: ['../accounting/accounting-sheet.scss', './invoice-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceDetailPage {
  private readonly api = inject(InvoicingApi);
  private readonly lineApi = inject(EntryLinesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(AlcoToastService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly reasons = inject(ClosingReasonDialogService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly session = inject(SessionStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly year = String(new Date().getFullYear());
  private readonly countries = new Intl.DisplayNames(['fr'], { type: 'region' });

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly record = requestState(() => this.api.invoice(this.id));
  protected readonly invoice = computed(() => this.record.value());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly tab = signal('lines');
  protected readonly auditType = AUDIT_TYPES.invoice;
  protected readonly accounting = ACCOUNTING;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  protected readonly canOpenEntries = computed(() => this.session.can('accounting.read'));
  protected readonly canOpenPartners = computed(() => this.session.can('partners.read'));

  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, INVOICING_ERRORS) : null;
  });
  protected readonly spec = computed(() => {
    const invoice = this.invoice();
    return invoice ? KINDS[invoice.kind] : null;
  });
  protected readonly kindLabel = computed(() => {
    const invoice = this.invoice();
    return invoice ? KIND_LABELS[invoice.kind] : '';
  });
  /** The breadcrumb's name of the record. */
  protected readonly title = computed(() => {
    const invoice = this.invoice();
    const spec = this.spec();
    if (!invoice || !spec) {
      return '';
    }
    return invoice.number ? `${spec.word} ${invoice.number}` : `${spec.word} (brouillon)`;
  });
  protected readonly steps = computed<readonly WorkflowStep[]>(() => [
    { id: 'draft', label: 'Brouillon' },
    { id: 'posted', label: 'Comptabilisé' },
    ...(this.invoice()?.status === 'cancelled' ? [{ id: 'cancelled', label: 'Annulé' }] : []),
  ]);
  /** The corner ribbon, as in Odoo: Partiel, Payé, or Extourné when only credit notes. */
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
  protected readonly newUrl = computed(() => {
    const spec = this.spec();
    return spec?.creatable && this.session.can('invoicing.create')
      ? `${ACCOUNTING}/${spec.path}/nouvelle`
      : null;
  });
  protected readonly originUrl = computed(() => {
    const invoice = this.invoice();
    if (!invoice?.origin) {
      return null;
    }
    const kind = invoice.kind === 'customer_credit_note' ? 'customer_invoice' : 'supplier_invoice';
    return invoiceUrl(kind, invoice.origin);
  });
  protected readonly address = computed(() => {
    const partner = this.invoice()?.partner;
    if (!partner) {
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
    {
      id: 'lines',
      label: this.invoice()?.kind.endsWith('credit_note') ? 'Lignes d’avoir' : 'Lignes de facture',
    },
    ...(this.invoice()?.entry && this.canOpenEntries()
      ? [{ id: 'entries', label: 'Écritures comptables' }]
      : []),
    { id: 'other', label: 'Autres informations' },
  ]);

  protected readonly lineColumns: readonly TableColumn[] = [
    { key: 'product', label: 'Produit' },
    { key: 'account', label: 'Compte', hideBelow: 'tablet' },
    { key: 'quantity', label: 'Quantité', width: '7rem', numeric: true },
    { key: 'price', label: 'Prix', width: '9rem', numeric: true },
    { key: 'tax', label: 'Taxes', width: '8rem', hideBelow: 'tablet' },
    { key: 'amount', label: 'Montant', width: '10rem', numeric: true },
  ];
  protected readonly lineId = (line: InvoiceLine) => String(line.sequence);
  protected readonly lineLabel = (line: InvoiceLine) => `Ligne ${line.sequence}`;

  /** « Écritures comptables »: the lines of its entry, read when the tab opens. */
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

  /** The commands the state and the permissions allow, as Odoo's buttons; the server decides. */
  protected readonly actions = computed<
    readonly { id: Action; label: string; variant: ButtonVariant }[]
  >(() => {
    const invoice = this.invoice();
    if (!invoice) {
      return [];
    }
    const can = (permission: string) => this.session.can(permission);
    const ids: Action[] = [];
    if (invoice.status === 'draft') {
      if (can('invoicing.post')) {
        ids.push('post');
      }
      if (can('invoicing.update')) {
        ids.push('edit');
      }
      // A draft reset to draft keeps its number: it is cancelled, never deleted.
      if (invoice.number ? can('invoicing.cancel') : can('invoicing.update')) {
        ids.push(invoice.number ? 'cancel' : 'remove');
      }
    }
    if (invoice.status === 'posted') {
      if (this.spec()?.creatable && can('invoicing.create')) {
        ids.push('creditNote');
      }
      if (can('invoicing.cancel')) {
        ids.push('reset');
      }
    }
    return ids.map((id) => ({ id, ...ACTIONS[id] }));
  });

  constructor() {
    // Named after the document once loaded (BreadcrumbService.nameCurrent).
    effect(() => {
      const title = this.title();
      if (title) {
        untracked(() => this.breadcrumbs.nameCurrent(title));
      }
    });
    effect(() => {
      if (this.tab() === 'entries' && this.invoice()?.entry) {
        untracked(() => this.entryLines.reload());
      }
    });
    // A tab that no longer exists (the entry gone after a reset): back to the lines.
    effect(() => {
      if (!this.tabs().some((item) => item.id === this.tab())) {
        this.tab.set('lines');
      }
    });
  }

  /** « 10 oct. » this year, « 10 oct. 2025 » before, as in Odoo. */
  protected shortDate(value: string): string {
    return formatDate(value, value.startsWith(this.year) ? 'd MMM' : 'd MMM y', this.locale);
  }

  protected productUrl(line: InvoiceLine): string {
    return `${ACCOUNTING}/produits/${line.product.public_id}`;
  }

  protected creditNoteUrl(kind: InvoiceKind, noteId: string): string {
    return invoiceUrl(kind, noteId);
  }

  protected async act(action: Action): Promise<void> {
    switch (action) {
      case 'post':
        return this.post();
      case 'edit':
        await this.router.navigate(['modifier'], { relativeTo: this.route });
        return;
      case 'remove':
        return this.remove();
      case 'cancel':
        return this.cancel();
      case 'creditNote':
        return this.creditNote();
      case 'reset':
        return this.reset();
    }
  }

  protected async post(): Promise<void> {
    const invoice = this.invoice();
    const spec = this.spec();
    if (!invoice || !spec) {
      return;
    }
    const ok = await this.confirm.confirm({
      title: `Comptabiliser ${spec.word.toLowerCase()} ?`,
      message:
        (invoice.number
          ? `Il garde son numéro ${invoice.number}. `
          : 'Le serveur lui donne son numéro. ') +
        `Son écriture est créée dans le journal ${invoice.journal.code}, validée tout de suite. ` +
        'Pour la corriger ensuite : un avoir, ou « Remettre en brouillon ».',
      confirmLabel: 'Comptabiliser',
    });
    if (ok) {
      await this.run(this.api.post(invoice.public_id), (saved) => {
        const number = saved.entry?.entry_number ?? '';
        return `${spec.word} ${saved.number} comptabilisée : écriture ${number}.`;
      });
    }
  }

  protected async remove(): Promise<void> {
    const invoice = this.invoice();
    const spec = this.spec();
    if (!invoice || !spec) {
      return;
    }
    const ok = await this.confirm.confirm({
      title: 'Supprimer ce brouillon ?',
      message: 'Il n’a pas de numéro : sa suppression ne laisse pas de trou.',
      confirmLabel: 'Supprimer le brouillon',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deleteInvoice(invoice.public_id));
      this.toast.success('Brouillon supprimé.');
      await this.router.navigateByUrl(`${ACCOUNTING}/${spec.path}`);
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.busy.set(false);
    }
  }

  protected async creditNote(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice) {
      return;
    }
    this.busy.set(true);
    try {
      const note = await firstValueFrom(this.api.creditNote(invoice.public_id));
      this.toast.success('Avoir créé en brouillon : ajustez ses lignes, puis comptabilisez-le.');
      await this.router.navigateByUrl(`${invoiceUrl(note.kind, note.public_id)}/modifier`);
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.busy.set(false);
    }
  }

  protected async reset(): Promise<void> {
    const invoice = this.invoice();
    const spec = this.spec();
    if (!invoice || !spec) {
      return;
    }
    const ok = await this.confirm.confirm({
      title: `Remettre ${spec.word.toLowerCase()} ${invoice.number} en brouillon ?`,
      message:
        `Son écriture ${invoice.entry?.entry_number ?? ''} est extournée aujourd’hui. Le document ` +
        'redevient modifiable et garde son numéro ; comptabilisez-le à nouveau ensuite. Seul un ' +
        'document sans règlement ni avoir se remet en brouillon.',
      confirmLabel: 'Remettre en brouillon',
    });
    if (ok) {
      await this.run(
        this.api.resetToDraft(invoice.public_id),
        (saved) => `${spec.word} ${saved.number} remise en brouillon.`,
      );
    }
  }

  protected async cancel(): Promise<void> {
    const invoice = this.invoice();
    const spec = this.spec();
    if (!invoice || !spec) {
      return;
    }
    const reason = await this.reasons.ask({
      title: `Annuler ${spec.word.toLowerCase()} ${invoice.number} ?`,
      message:
        'Le document reste, annulé, avec son numéro. Son écriture a déjà été extournée à la ' +
        'remise en brouillon.',
      confirmLabel: 'Annuler le document',
      tone: 'danger',
      hint: 'Gardé dans l’historique du document.',
    });
    if (reason) {
      await this.run(this.api.cancel(invoice.public_id, reason), () => `${spec.word} annulée.`);
    }
  }

  private async run(request: Observable<Invoice>, done: (saved: Invoice) => string): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const saved = await firstValueFrom(request);
      this.toast.success(done(saved));
      this.record.reload();
    } catch (failure) {
      this.fail(failure);
    } finally {
      this.busy.set(false);
    }
  }

  private fail(failure: unknown): void {
    const error = toUserError(failure, INVOICING_ERRORS);
    this.actionError.set(error);
    if (STALE.has(error.code)) {
      this.record.reload();
    }
  }
}
