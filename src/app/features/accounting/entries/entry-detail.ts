import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Observable,
  catchError,
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  switchMap,
} from 'rxjs';

import { UserError, toUserError } from '../../../core/errors/user-error';
import { ApiError, toApiError } from '../../../core/http/api-error';
import { requestState } from '../../../core/http/request-state';
import { APP_ROOT } from '../../../core/navigation/applications';
import { NavigationService } from '../../../core/navigation/navigation.service';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../../shared/tables/table';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import {
  AlcoConfirmService,
  ConfirmOptions,
} from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { IconName } from '../../../shared/ui/icon/icons';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AlcoWorkflowSteps } from '../../../shared/ui/workflow-steps/workflow-steps';
import { isZeroDecimal, subtractDecimals, sumDecimals } from '../../../shared/utils/decimal';
import { localToday } from '../../../shared/utils/dates';
import { InvoicingApi } from '../../invoicing/data-access/invoicing-api';
import { Invoice } from '../../invoicing/data-access/invoicing-models';
import { KINDS, invoiceUrl } from '../../invoicing/invoicing-presentation';
import { PartnersApi } from '../../partners/data-access/partners-api';
import { TreasuryApi, TreasuryOperationSummary } from '../../treasury/data-access/treasury-api';
import { EntriesApi } from '../data-access/entries-api';
import { Entry, EntryCommand, EntryLine } from '../data-access/entry-models';
import { AlcoEntryDocuments } from './entry-documents';
import { AUDIT_TYPES, AlcoObjectHistory } from '../../audit/object-history';
import {
  ENTRY_ERRORS,
  ENTRY_KINDS,
  ENTRY_STATUS,
  ENTRY_WORKFLOW,
  ROUNDING_MODES,
  isoDay,
} from './entry-presentation';
import { ReverseDialogService } from './reverse-dialog';

type Action = 'edit' | EntryCommand | 'reverse' | 'delete';

interface ActionSpec {
  readonly label: string;
  readonly icon: IconName;
  readonly danger?: boolean;
}

const ACCOUNTING = `${APP_ROOT}/comptabilite`;

/** The entry of an invoice: Facturation corrects it, never a reversal by hand. */
const fromInvoice = (entry: Entry) => entry.source_type === 'invoicing.invoice';

/** Modules that generate entries (`source_type` = `<module>.<object>`), in words. */
const SOURCE_MODULES: Readonly<Record<string, string>> = {
  invoicing: 'Facturation',
  treasury: 'Trésorerie',
  assets: 'Immobilisations',
  loans: 'Emprunts',
  closing: 'Clôture',
  imports_exports: 'Import d’écritures',
};

const ACTIONS: Readonly<Record<Action, ActionSpec>> = {
  edit: { label: 'Modifier', icon: 'edit' },
  submit: { label: 'Soumettre', icon: 'arrow-up' },
  validate: { label: 'Valider', icon: 'check' },
  reject: { label: 'Renvoyer en brouillon', icon: 'arrow-left' },
  lock: { label: 'Verrouiller', icon: 'lock' },
  reverse: { label: 'Contrepasser', icon: 'reverse' },
  delete: { label: 'Supprimer le brouillon', icon: 'trash', danger: true },
};

/** Confirmations: what the server will really do (backend apps/accounting/services). */
const CONFIRMATIONS: Readonly<Record<EntryCommand, ConfirmOptions>> = {
  submit: {
    title: 'Soumettre l’écriture pour validation ?',
    message:
      'Elle ne sera plus modifiable. Un validateur pourra la valider, ou la renvoyer en brouillon.',
    confirmLabel: 'Soumettre',
  },
  validate: {
    title: 'Valider l’écriture ?',
    message:
      'Le serveur contrôle l’équilibre, la période et les comptes, puis attribue le numéro ' +
      'définitif. Une écriture validée ne se modifie plus et ne se supprime plus ; pour la ' +
      'corriger, il faudra la contrepasser.',
    confirmLabel: 'Valider l’écriture',
  },
  reject: {
    title: 'Renvoyer l’écriture en brouillon ?',
    message: 'Elle redeviendra modifiable, puis devra être soumise à nouveau.',
    confirmLabel: 'Renvoyer en brouillon',
  },
  lock: {
    title: 'Verrouiller l’écriture ?',
    message:
      'Une écriture verrouillée ne change plus d’état. Elle pourra encore être contrepassée.',
    confirmLabel: 'Verrouiller',
    tone: 'danger',
  },
};

const DONE: Readonly<Record<EntryCommand, (entry: Entry) => string>> = {
  submit: () => 'Écriture soumise pour validation.',
  validate: (entry) => `Écriture validée : n° ${entry.entry_number}.`,
  reject: () => 'Écriture renvoyée en brouillon.',
  lock: () => 'Écriture verrouillée.',
};

/** Words of the server's details that name the object at fault (an account code…). */
const DETAIL_WORDS: Readonly<Record<string, string>> = {
  account: 'Compte',
  journal: 'Journal',
  period: 'Période',
  fiscal_year: 'Exercice',
  currency: 'Devise',
  tax: 'Taxe',
};

/**
 * An entry (`GET accounting/entries/{id}/`): its fields, its lines, its documents and its
 * history. The actions shown follow the server's state, the permissions of the active company
 * and the company's settings (`submission_required`); each is a command of the API, confirmed
 * first, and the server keeps the last word (a refused transition reloads the record).
 */
@Component({
  selector: 'alco-entry-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCell,
    AlcoDropdown,
    AlcoEntryDocuments,
    AlcoObjectHistory,
    AlcoErrorState,
    AlcoIcon,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
    AlcoWorkflowSteps,
  ],
  templateUrl: './entry-detail.html',
  styleUrls: ['../accounting-sheet.scss', './entry-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryDetailPage {
  private readonly api = inject(EntriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly confirm = inject(AlcoConfirmService);
  private readonly reverseDialog = inject(ReverseDialogService);
  private readonly toast = inject(AlcoToastService);
  protected readonly session = inject(SessionStore);

  private readonly id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    { requireSync: true },
  );
  protected readonly record = requestState(() => this.api.get(untracked(this.id)), {
    immediate: false,
  });
  protected readonly entry = signal<Entry | null>(null);
  protected readonly busy = signal<Action | null>(null);
  protected readonly actionError = signal<UserError | null>(null);
  private readonly history = viewChild(AlcoObjectHistory);

  /** The company's rules; unknown (failure): no validation straight from a draft. */
  private readonly settings = toSignal(this.api.settings().pipe(catchError(() => of(null))), {
    initialValue: null,
  });
  private readonly decimalsByCurrency = toSignal(
    inject(PartnersApi)
      .currencies()
      .pipe(
        map((page) => new Map(page.results.map((item) => [item.code, item.decimal_places]))),
        catchError(() => of(new Map<string, number>())),
      ),
    { initialValue: new Map<string, number>() },
  );

  // ---- Related objects (links by the public ids the API gives) --------------------------
  private readonly navigation = inject(NavigationService);
  protected readonly accounting = ACCOUNTING;
  /** Partners open from Comptabilité › Tiers (`partners.read`). */
  protected readonly canOpenPartners = computed(() => this.canOpen('contacts'));
  /** The treasury operations this entry accounts (`treasury.read`), none otherwise. */
  private readonly treasuryApi = inject(TreasuryApi);
  protected readonly treasuryOperations = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        id && this.session.can('treasury.read')
          ? this.treasuryApi.operationsOfEntry(id).pipe(
              map((page) => page.results),
              catchError(() => of([] as TreasuryOperationSummary[])),
            )
          : of([] as TreasuryOperationSummary[]),
      ),
    ),
    { initialValue: [] as TreasuryOperationSummary[] },
  );
  protected readonly treasuryUrl = computed(() =>
    this.canOpen('tresorerie/operations') ? `${ACCOUNTING}/tresorerie/operations` : null,
  );
  /** The invoice an entry comes from (source `invoicing.invoice`, `invoicing.read`). */
  private readonly invoicingApi = inject(InvoicingApi);
  private readonly sourceInvoice = toSignal(
    toObservable(this.entry).pipe(
      map((entry) => (entry?.source_type === 'invoicing.invoice' ? entry.source_id : '')),
      distinctUntilChanged(),
      switchMap((invoiceId) =>
        invoiceId && this.session.can('invoicing.read')
          ? this.invoicingApi.invoice(invoiceId).pipe(catchError(() => of(null as Invoice | null)))
          : of(null as Invoice | null),
      ),
    ),
    { initialValue: null as Invoice | null },
  );
  /** « Facture FV-2026-0001 » and its record, from the entry (the link back). */
  protected readonly invoiceLink = computed(() => {
    const invoice = this.sourceInvoice();
    return invoice
      ? {
          label: `${KINDS[invoice.kind].word} ${invoice.number}`,
          url: invoiceUrl(invoice.kind, invoice.public_id),
        }
      : null;
  });
  /** « Trésorerie », « Immobilisations »…: the module that generated the entry. */
  protected readonly sourceLabel = computed(() => {
    const type = this.entry()?.source_type ?? '';
    return type ? (SOURCE_MODULES[type.split('.')[0]] ?? type) : '';
  });

  protected readonly workflow = ENTRY_WORKFLOW;
  protected readonly auditTypes = AUDIT_TYPES;
  protected readonly day = isoDay;
  protected readonly canSeeDocuments = computed(() => this.session.can('documents.read'));
  protected readonly canSeeHistory = computed(() => this.session.can('audit.read'));

  protected readonly loadError = computed(() => {
    const error = this.record.error();
    return error ? toUserError(error, ENTRY_ERRORS) : null;
  });
  protected readonly status = computed(() => {
    const entry = this.entry();
    return entry ? ENTRY_STATUS[entry.status] : null;
  });
  protected readonly title = computed(() => {
    const entry = this.entry();
    return entry ? entry.entry_number || 'Écriture sans numéro' : '';
  });
  protected readonly decimals = computed(
    () => this.decimalsByCurrency().get(this.entry()?.currency ?? '') ?? 0,
  );
  protected readonly referenceDecimals = computed(
    () => this.decimalsByCurrency().get(this.entry()?.reference_currency ?? '') ?? 0,
  );
  protected readonly foreignCurrency = computed(() => {
    const entry = this.entry();
    return !!entry && entry.currency !== entry.reference_currency;
  });
  protected readonly kindLabel = computed(() => {
    const entry = this.entry();
    return entry ? ENTRY_KINDS[entry.kind] : '';
  });
  protected readonly roundingLabel = computed(() => {
    const rounding = this.entry()?.rounding;
    return rounding ? (ROUNDING_MODES.find((mode) => mode.id === rounding)?.label ?? rounding) : '';
  });

  /** Why the entry cannot be modified (the server's rules, said in words). */
  protected readonly readOnlyReason = computed(() => {
    const entry = this.entry();
    if (!entry) {
      return null;
    }
    switch (entry.status) {
      case 'submitted':
        return 'Soumise : elle ne se modifie plus. Un validateur peut la valider, ou la renvoyer en brouillon.';
      case 'validated':
        return fromInvoice(entry)
          ? 'Générée par une facture : elle se corrige par un avoir, ou par l’annulation de la facture.'
          : 'Validée : elle ne se modifie plus. Pour la corriger, contrepassez-la.';
      case 'locked':
        return 'Verrouillée : elle ne change plus d’état. Elle peut encore être contrepassée.';
    }
    if (entry.kind === 'reversal') {
      return 'Contrepassation : ses lignes viennent de l’écriture d’origine, elle ne se modifie pas.';
    }
    if (entry.origin !== 'manual') {
      return 'Écriture générée par l’application : elle ne se modifie pas ici.';
    }
    return null;
  });

  // ---- Lines and their totals (a reading aid, summed exactly) ----------------------------
  protected readonly columns = computed<readonly TableColumn[]>(() => {
    const entry = this.entry();
    const currency = entry?.currency ?? '';
    const reference = entry?.reference_currency ?? '';
    return [
      { key: 'account', label: 'Compte', width: '8rem' },
      { key: 'label', label: 'Libellé' },
      { key: 'partner', label: 'Tiers', hideBelow: 'tablet' },
      { key: 'tax', label: 'Taxe', hideBelow: 'laptop' },
      { key: 'debit', label: `Débit (${currency})`, numeric: true },
      { key: 'credit', label: `Crédit (${currency})`, numeric: true },
      ...(this.foreignCurrency()
        ? [
            {
              key: 'reference_debit',
              label: `Débit (${reference})`,
              numeric: true,
              hideBelow: 'laptop' as const,
            },
            {
              key: 'reference_credit',
              label: `Crédit (${reference})`,
              numeric: true,
              hideBelow: 'laptop' as const,
            },
          ]
        : []),
    ];
  });
  protected readonly lineId = (line: EntryLine) => line.public_id;
  protected readonly lineLabel = (line: EntryLine) => `Ligne ${line.sequence}`;
  private readonly sums = computed(() => {
    const lines = this.entry()?.lines ?? [];
    const sum = (pick: (line: EntryLine) => string) => sumDecimals(lines.map(pick));
    const debit = sum((line) => line.debit);
    const credit = sum((line) => line.credit);
    return {
      debit,
      credit,
      referenceDebit: sum((line) => line.reference_debit),
      referenceCredit: sum((line) => line.reference_credit),
      gap: subtractDecimals(debit, credit).replace('-', ''),
    };
  });
  protected readonly gap = computed(() => {
    const gap = this.sums().gap;
    return isZeroDecimal(gap) ? null : gap;
  });
  protected readonly totals = computed(() => {
    const sums = this.sums();
    const amount = new AlcoAmountPipe();
    return {
      debit: amount.transform(sums.debit, this.decimals()),
      credit: amount.transform(sums.credit, this.decimals()),
      ...(this.foreignCurrency()
        ? {
            reference_debit: amount.transform(sums.referenceDebit, this.referenceDecimals()),
            reference_credit: amount.transform(sums.referenceCredit, this.referenceDecimals()),
          }
        : {}),
    };
  });

  // ---- Actions: the state and the permissions; the server decides ------------------------
  private readonly available = computed<readonly Action[]>(() => {
    const entry = this.entry();
    if (!entry) {
      return [];
    }
    const can = (permission: string) => this.session.can(permission);
    const draft = entry.status === 'draft';
    const posted = entry.status === 'validated' || entry.status === 'locked';
    const actions: Action[] = [];
    if (draft && this.validatesFromDraft()) {
      actions.push('validate');
    }
    if (entry.status === 'submitted' && can('accounting.validate')) {
      actions.push('validate');
    }
    if (draft && can('accounting.submit')) {
      actions.push('submit');
    }
    // An invoice's entry is corrected by a credit note or its cancellation (note backend 0038).
    if (posted && entry.kind !== 'reversal' && !fromInvoice(entry) && can('accounting.reverse')) {
      actions.push('reverse');
    }
    if (entry.status === 'validated' && can('accounting.lock')) {
      actions.push('lock');
    }
    if (entry.status === 'submitted' && can('accounting.validate')) {
      actions.push('reject');
    }
    if (
      draft &&
      entry.origin === 'manual' &&
      entry.kind !== 'reversal' &&
      can('accounting.update')
    ) {
      actions.push('edit');
    }
    if (draft && can('accounting.update')) {
      actions.push('delete');
    }
    return actions;
  });
  /** The first one is the screen's main action; the others go under « Actions ▾ ». */
  protected readonly primary = computed(() => {
    const first = this.available()[0];
    return first && first !== 'delete' ? { id: first, ...ACTIONS[first] } : null;
  });
  protected readonly menu = computed<readonly DropdownItem[]>(() => {
    const primary = this.primary()?.id;
    return this.available()
      .filter((action) => action !== primary)
      .map((action) => ({
        id: action,
        label: ACTIONS[action].label,
        icon: ACTIONS[action].icon,
        danger: ACTIONS[action].danger,
        dividerBefore: action === 'delete',
        disabled: this.busy() !== null,
      }));
  });

  /** The application and the screen are both open to the user (never one alone). */
  private canOpen(path: string): boolean {
    return this.navigation.canOpenUrl(`${ACCOUNTING}/${path}`);
  }

  constructor() {
    effect(() => {
      this.id();
      untracked(() => {
        this.entry.set(null);
        this.actionError.set(null);
        this.record.reload();
      });
    });
    effect(() => {
      const loaded = this.record.value();
      if (loaded) {
        untracked(() => this.show(loaded));
      }
    });
  }

  protected run(action: string): void {
    switch (action as Action) {
      case 'edit':
        void this.router.navigate(['modifier'], { relativeTo: this.route });
        return;
      case 'reverse':
        void this.reverse();
        return;
      case 'delete':
        void this.remove();
        return;
      default:
        void this.command(action as EntryCommand);
    }
  }

  protected onMenu(item: DropdownItem): void {
    this.run(item.id);
  }

  protected lineSide(
    line: EntryLine,
    side: 'debit' | 'credit' | 'reference_debit' | 'reference_credit',
  ): string {
    return isZeroDecimal(line[side]) ? '' : line[side];
  }

  private validatesFromDraft(): boolean {
    return (
      this.settings()?.submission_required === false && this.session.can('accounting.validate')
    );
  }

  private async command(command: EntryCommand): Promise<void> {
    const entry = this.entry();
    if (!entry || this.busy()) {
      return;
    }
    if (!(await this.confirm.confirm(CONFIRMATIONS[command]))) {
      return;
    }
    const updated = await this.send(command, this.api.run(entry.public_id, command));
    if (updated) {
      this.show(updated);
      this.history()?.reload();
      this.toast.success(DONE[command](updated));
    }
  }

  private async reverse(): Promise<void> {
    const entry = this.entry();
    if (!entry || this.busy()) {
      return;
    }
    const request = await this.reverseDialog.ask(this.title(), localToday());
    if (!request) {
      return;
    }
    const reversal = await this.send('reverse', this.api.reverse(entry.public_id, request));
    if (reversal) {
      this.toast.success('Contrepassation créée en brouillon : elle reste à valider.');
      await this.router.navigate(['..', reversal.public_id], { relativeTo: this.route });
    }
  }

  private async remove(): Promise<void> {
    const entry = this.entry();
    if (!entry || this.busy()) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: 'Supprimer ce brouillon ?',
      message: 'Le brouillon et ses lignes seront définitivement supprimés.',
      confirmLabel: 'Supprimer le brouillon',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    const done = await this.send('delete', this.api.remove(entry.public_id).pipe(map(() => true)));
    if (done) {
      this.toast.success('Brouillon supprimé.');
      await this.router.navigate(['..'], { relativeTo: this.route });
    }
  }

  /** One command at a time; a refusal is said (and a changed state reloaded). */
  private async send<T>(action: Action, request: Observable<T>): Promise<T | null> {
    this.busy.set(action);
    this.actionError.set(null);
    try {
      return await firstValueFrom(request);
    } catch (failure) {
      this.fail(toApiError(failure));
      return null;
    } finally {
      this.busy.set(null);
    }
  }

  private fail(error: ApiError): void {
    if (error.kind === 'unauthenticated') {
      return;
    }
    const message = toUserError(error, ENTRY_ERRORS);
    const named = this.namedObjects(error.details);
    this.actionError.set(named ? { ...message, message: `${message.message} ${named}` } : message);
    if (error.code === 'accounting_invalid_transition' || error.code === 'not_found') {
      this.record.reload(); // the state changed meanwhile: show the server's one
    }
  }

  /** « Compte concerné : 401100. » from the details of a business refusal. */
  private namedObjects(details: unknown): string | null {
    if (!details || typeof details !== 'object') {
      return null;
    }
    const parts = Object.entries(details as Record<string, unknown>)
      .filter(([key, value]) => key in DETAIL_WORDS && typeof value === 'string')
      .map(([key, value]) => `${DETAIL_WORDS[key]} concerné : ${value as string}.`);
    return parts.length > 0 ? parts.join(' ') : null;
  }

  private show(entry: Entry): void {
    this.entry.set(entry);
    this.breadcrumbs.nameCurrent(entry.entry_number || `Brouillon du ${isoDay(entry.entry_date)}`);
  }
}
