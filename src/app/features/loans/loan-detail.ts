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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { BreadcrumbService } from '../../core/navigation/route-trail';
import { SessionStore } from '../../core/session/session.store';
import { AlcoAmountPipe } from '../../shared/pipes/amount.pipe';
import { AlcoCell, AlcoTable, TableColumn } from '../../shared/tables/table';
import { AlcoBadge } from '../../shared/ui/badge/badge';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { formatDecimal, trimDecimalZeros } from '../../shared/utils/decimal';
import { ClosingReasonDialogService } from '../closing/reason-dialog';
import { referencePlaces } from '../currencies/reference-places';
import { PartnersApi } from '../partners/data-access/partners-api';
import { LoansApi } from './data-access/loans-api';
import { Loan, ScheduleLine } from './data-access/loans-models';
import { LoanDialogService } from './loan-dialogs';
import {
  FREQUENCIES,
  LINE_STATUS,
  LOAN_ERRORS,
  LOAN_STATUS,
  METHODS,
  wordOf,
} from './loans-presentation';

const OPEN = new Set(['planned', 'partial']);

/** One loan: what remains owed, its schedule, and its next step (activate, pay, prepay). */
@Component({
  selector: 'alco-loan-detail',
  imports: [
    DatePipe,
    RouterLink,
    AlcoAmountPipe,
    AlcoBadge,
    AlcoButton,
    AlcoCard,
    AlcoCell,
    AlcoErrorState,
    AlcoLoading,
    AlcoPageHeader,
    AlcoTable,
  ],
  templateUrl: './loan-detail.html',
  styleUrl: './loan-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanDetailPage {
  private readonly api = inject(LoansApi);
  private readonly partners = inject(PartnersApi);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly reasons = inject(ClosingReasonDialogService);
  private readonly dialogs = inject(LoanDialogService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly loanId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly places = referencePlaces();
  protected readonly status = LOAN_STATUS;
  protected readonly loan = requestState(() => this.api.loan(this.loanId));
  /** The active schedule; for a draft, the one the server's engine would give it. */
  protected readonly schedule = requestState(() => this.scheduleOf(), { immediate: false });
  protected readonly lender = signal<string | null>(null);
  /** The command running: `activate`, `cancel`, `pay` or `prepay`. */
  protected readonly busy = signal<string | null>(null);

  protected readonly lines = computed(() => this.schedule.value() ?? []);
  protected readonly next = computed(() =>
    this.lines().find((line) => OPEN.has(line.status ?? '')),
  );
  protected readonly isDraft = computed(() => this.loan.value()?.status === 'draft');
  protected readonly isActive = computed(() => this.loan.value()?.status === 'active');
  protected readonly canEdit = computed(() => this.isDraft() && this.session.can('loans.update'));
  protected readonly canActivate = computed(() => this.isDraft() && this.allowed('loans.activate'));
  protected readonly canPay = computed(
    () => this.isActive() && this.next() !== undefined && this.allowed('loans.pay'),
  );
  protected readonly canPrepay = computed(() => this.isActive() && this.allowed('loans.prepay'));
  protected readonly loadError = computed(() => {
    const error = this.loan.error();
    return error ? toUserError(error, LOAN_ERRORS) : null;
  });
  protected readonly scheduleError = computed(() => {
    const error = this.schedule.error();
    return error ? toUserError(error, LOAN_ERRORS) : null;
  });

  protected readonly columns: readonly TableColumn[] = [
    { key: 'sequence', label: 'N°', width: '4rem' },
    { key: 'due', label: 'Échéance', width: '8rem' },
    { key: 'principal', label: 'Capital', width: '9rem', numeric: true, hideBelow: 'tablet' },
    { key: 'interest', label: 'Intérêts', width: '9rem', numeric: true, hideBelow: 'tablet' },
    { key: 'total', label: 'À payer', width: '9rem', numeric: true },
    { key: 'balance', label: 'Restant dû', width: '10rem', numeric: true },
    { key: 'status', label: 'État', width: '9rem' },
  ];
  protected readonly lineId = (line: ScheduleLine) => String(line.sequence);

  constructor() {
    effect(() => {
      const loan = this.loan.value();
      if (loan) {
        untracked(() => {
          this.breadcrumbs.nameCurrent(loan.name);
          this.schedule.reload();
          this.nameLender(loan);
        });
      }
    });
  }

  protected frequency(loan: Loan): string {
    return wordOf(FREQUENCIES, loan.payment_frequency).toLowerCase();
  }

  protected method(loan: Loan): string {
    return wordOf(METHODS, loan.repayment_method);
  }

  protected rate(loan: Loan): string {
    return `${trimDecimalZeros(loan.interest_rate, 0).replace('.', ',')} %`;
  }

  protected lineStatus(line: ScheduleLine): string {
    return line.status ? LINE_STATUS[line.status] : '—';
  }

  protected async activate(): Promise<void> {
    const loan = this.loan.value();
    if (!loan) {
      return;
    }
    const amount = formatDecimal(trimDecimalZeros(loan.principal_amount, 0), 0);
    const fees = loan.fees.some((fee) => fee.kind === 'initial') ? ' et les frais de dossier' : '';
    const answer = await this.dialogs.pay({
      title: 'Activer l’emprunt ?',
      message: `Les ${amount} sont reçus à la date de déblocage : l’emprunt${fees} sont comptabilisés dans ce journal. Il ne se modifie plus ensuite.`,
      confirmLabel: 'Activer',
      date: null,
    });
    if (answer) {
      await this.run('activate', async () => {
        await firstValueFrom(this.api.activate(this.loanId, answer.journal));
        this.toast.success('Emprunt activé : le déblocage est comptabilisé.');
      });
    }
  }

  protected async cancel(): Promise<void> {
    const reason = await this.reasons.ask({
      title: 'Annuler cet emprunt ?',
      message: 'Il reste visible, annulé ; rien n’est comptabilisé.',
      confirmLabel: 'Annuler l’emprunt',
      tone: 'danger',
    });
    if (reason) {
      await this.run('cancel', async () => {
        await firstValueFrom(this.api.cancel(this.loanId, reason));
        this.toast.success('Emprunt annulé.');
      });
    }
  }

  protected async pay(): Promise<void> {
    const line = this.next();
    if (!line?.public_id) {
      return;
    }
    const answer = await this.dialogs.pay({
      title: `Payer l’échéance n°${line.sequence} ?`,
      message:
        'Ce qu’il reste dû sur l’échéance (capital, intérêts, frais) est payé et comptabilisé.',
      confirmLabel: 'Payer',
      date: line.due_date,
    });
    const lineId = line.public_id;
    if (answer) {
      await this.run('pay', async () => {
        await firstValueFrom(this.api.pay(lineId, answer.date, answer.journal));
        this.toast.success(`Échéance n°${line.sequence} payée et comptabilisée.`);
      });
    }
  }

  protected async prepay(): Promise<void> {
    const prepayment = await this.dialogs.prepay();
    if (prepayment) {
      await this.run('prepay', async () => {
        await firstValueFrom(this.api.prepay(this.loanId, prepayment));
        this.toast.success('Remboursement anticipé comptabilisé ; l’échéancier est recalculé.');
      });
    }
  }

  /** The right asked, and posting: every payment is posted at once (note backend 0062). */
  private allowed(permission: string): boolean {
    return this.session.can(permission) && this.session.can('loans.account');
  }

  private scheduleOf(): Observable<readonly ScheduleLine[]> {
    const loan = this.loan.value();
    if (!loan || loan.status === 'cancelled') {
      return of([]);
    }
    if (loan.status === 'draft') {
      return this.api
        .simulate({
          currency: loan.currency,
          principal_amount: loan.principal_amount,
          start_date: loan.start_date,
          first_payment_date: loan.first_payment_date,
          interest_rate: loan.interest_rate,
          payment_frequency: loan.payment_frequency,
          repayment_method: loan.repayment_method,
          installments: loan.installments,
          day_count: loan.day_count,
          rounding: loan.rounding,
        })
        .pipe(map((simulated) => simulated.lines));
    }
    return this.api
      .schedule(loan.public_id)
      .pipe(map((schedule) => schedule.lines.filter((line) => line.status !== 'superseded')));
  }

  private nameLender(loan: Loan): void {
    this.lender.set(loan.partner.code || null);
    this.partners
      .get(loan.partner.public_id)
      .pipe(catchError(() => of(null)))
      .subscribe((partner) => {
        if (partner) {
          this.lender.set(partner.name);
        }
      });
  }

  private async run(key: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(key);
    try {
      await action();
    } catch (failure) {
      const error = toUserError(failure, LOAN_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.busy.set(null);
      this.loan.reload();
    }
  }
}
