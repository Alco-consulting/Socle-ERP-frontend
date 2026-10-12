import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
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
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoConfirmService } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { IconName } from '../../shared/ui/icon/icons';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { AUDIT_TYPES, AlcoObjectHistory } from '../audit/object-history';
import { ClosingReasonDialogService } from '../closing/reason-dialog';
import { InvoicingApi } from './data-access/invoicing-api';
import { Invoice, InvoiceLine, InvoiceTax } from './data-access/invoicing-models';
import {
  ACCOUNTING,
  INVOICE_STATUS,
  INVOICING_ERRORS,
  KINDS,
  PAYMENT_STATE,
  invoiceUrl,
} from './invoicing-presentation';

type Action = 'post' | 'edit' | 'remove' | 'creditNote' | 'cancel';

const ACTIONS: Readonly<
  Record<Action, { id: Action; label: string; icon: IconName; danger?: boolean }>
> = {
  post: { id: 'post', label: 'Comptabiliser', icon: 'check' },
  edit: { id: 'edit', label: 'Modifier', icon: 'edit' },
  remove: { id: 'remove', label: 'Supprimer le brouillon', icon: 'trash', danger: true },
  creditNote: { id: 'creditNote', label: 'Créer un avoir', icon: 'reverse' },
  cancel: { id: 'cancel', label: 'Annuler le document', icon: 'close', danger: true },
};

/** Codes after which the record is read again: another user changed it meanwhile. */
const STALE = new Set(['invoicing_invoice_not_draft', 'invoicing_invoice_not_posted']);

/**
 * The record of an invoice or a credit note (note backend 0038): its lines and taxes as the
 * server computed them, its totals, what remains due, the entry it generated (a link), and
 * the commands its state allows: « Comptabiliser » (the number and the entry, in one go),
 * « Modifier » and « Supprimer le brouillon » for a draft; « Créer un avoir » and « Annuler
 * la facture » (a reason; the entry is reversed) once posted.
 */
@Component({
  selector: 'alco-invoice-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDropdown,
    AlcoErrorState,
    AlcoLoading,
    AlcoObjectHistory,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './invoice-detail.html',
  styleUrls: ['../accounting/accounting-sheet.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceDetailPage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(AlcoToastService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly reasons = inject(ClosingReasonDialogService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly session = inject(SessionStore);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly record = requestState(() => this.api.invoice(this.id));
  protected readonly invoice = computed(() => this.record.value());
  protected readonly busy = signal(false);
  protected readonly actionError = signal<UserError | null>(null);
  protected readonly auditType = AUDIT_TYPES.invoice;
  protected readonly accounting = ACCOUNTING;
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));
  protected readonly canOpenEntries = computed(() => this.session.can('accounting.read'));

  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, INVOICING_ERRORS) : null;
  });
  protected readonly spec = computed(() => {
    const invoice = this.invoice();
    return invoice ? KINDS[invoice.kind] : null;
  });
  protected readonly title = computed(() => {
    const invoice = this.invoice();
    const spec = this.spec();
    if (!invoice || !spec) {
      return '';
    }
    return invoice.number ? `${spec.word} ${invoice.number}` : `${spec.word} (brouillon)`;
  });
  protected readonly status = computed(() => {
    const invoice = this.invoice();
    return invoice ? INVOICE_STATUS[invoice.status] : null;
  });
  protected readonly payment = computed(() => {
    const state = this.invoice()?.payment_state;
    return state ? PAYMENT_STATE[state] : null;
  });
  protected readonly originUrl = computed(() => {
    const invoice = this.invoice();
    if (!invoice?.origin) {
      return null;
    }
    const kind = invoice.kind === 'customer_credit_note' ? 'customer_invoice' : 'supplier_invoice';
    return invoiceUrl(kind, invoice.origin);
  });

  protected readonly lineColumns: readonly TableColumn[] = [
    { key: 'product', label: 'Produit' },
    { key: 'quantity', label: 'Quantité', width: '7rem', numeric: true },
    { key: 'price', label: 'Prix unitaire HT', width: '9rem', numeric: true },
    { key: 'tax', label: 'TVA', width: '8rem', hideBelow: 'tablet' },
    { key: 'amount', label: 'Montant HT', width: '9rem', numeric: true },
    { key: 'account', label: 'Compte', width: '7rem', hideBelow: 'laptop' },
  ];
  protected readonly taxColumns: readonly TableColumn[] = [
    { key: 'tax', label: 'TVA' },
    { key: 'base', label: 'Base HT', width: '10rem', numeric: true },
    { key: 'amount', label: 'Montant', width: '10rem', numeric: true },
    { key: 'account', label: 'Compte', width: '7rem', hideBelow: 'tablet' },
  ];
  protected readonly lineId = (line: InvoiceLine) => String(line.sequence);
  protected readonly lineLabel = (line: InvoiceLine) => `Ligne ${line.sequence}`;
  protected readonly taxId = (tax: InvoiceTax) => String(tax.sequence);
  protected readonly taxLabel = (tax: InvoiceTax) => tax.tax.name;

  /** The commands the state and the permissions allow; the server decides. */
  private readonly available = computed<readonly Action[]>(() => {
    const invoice = this.invoice();
    if (!invoice) {
      return [];
    }
    const can = (permission: string) => this.session.can(permission);
    const actions: Action[] = [];
    if (invoice.status === 'draft') {
      if (can('invoicing.post')) {
        actions.push('post');
      }
      if (can('invoicing.update')) {
        actions.push('edit', 'remove');
      }
    }
    if (invoice.status === 'posted') {
      if (this.spec()?.creatable && can('invoicing.create')) {
        actions.push('creditNote');
      }
      if (can('invoicing.cancel')) {
        actions.push('cancel');
      }
    }
    return actions;
  });
  /** « Comptabiliser » is the record's action; the others are in « Actions ▾ ». */
  protected readonly primary = computed(() =>
    this.available().includes('post') ? ACTIONS.post : null,
  );
  protected readonly menu = computed<readonly DropdownItem[]>(() =>
    this.available()
      .filter((action) => action !== 'post')
      .map((action) => ({
        id: action,
        label: ACTIONS[action].label,
        icon: ACTIONS[action].icon,
        danger: ACTIONS[action].danger,
      })),
  );

  constructor() {
    // Named after the document once loaded (BreadcrumbService.nameCurrent).
    effect(() => {
      const title = this.title();
      if (title) {
        untracked(() => this.breadcrumbs.nameCurrent(title));
      }
    });
  }

  protected onMenu(item: DropdownItem): void {
    void this.act(item.id as Action);
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
      case 'creditNote':
        return this.creditNote();
      case 'cancel':
        return this.cancel();
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
        'Le serveur lui donne son numéro et crée son écriture dans le journal ' +
        `${invoice.journal.code}, validée tout de suite. Elle ne se modifie plus ; pour la ` +
        'corriger : un avoir, ou son annulation.',
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

  protected async cancel(): Promise<void> {
    const invoice = this.invoice();
    const spec = this.spec();
    if (!invoice || !spec) {
      return;
    }
    const reason = await this.reasons.ask({
      title: `Annuler ${spec.word.toLowerCase()} ${invoice.number} ?`,
      message:
        'Son écriture est extournée aujourd’hui, et le document reste, annulé. Seul un ' +
        'document sans règlement ni avoir s’annule.',
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
