import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoInView } from '../../../shared/utils/in-view';
import { AlcoBalanceSidesPipe } from '../balance-sides';
import { GeneralLedgerFigures } from '../data-access/reporting-models';
import { day } from '../report-period/report-period';
import { CARD_LINES, Subject, SubjectLines } from './general-ledger-presentation';

/**
 * La vue « Comptes en T » du grand livre : une carte par compte (ou partenaire), ses mouvements
 * au débit à gauche et au crédit à droite, ses totaux et son solde avec sa nature. Les
 * mouvements sont ceux que le grand livre lit pour son tableau ; une carte les demande quand
 * elle arrive à l'écran (`shown`). Tous les chiffres sont ceux du serveur.
 */
@Component({
  selector: 'alco-t-accounts',
  imports: [AlcoAmountPipe, AlcoBalanceSidesPipe, AlcoButton, AlcoInView],
  templateUrl: './t-accounts.html',
  styleUrl: './t-accounts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoTAccounts {
  /** Le nom du rapport, pour nommer la liste des cartes. */
  readonly label = input.required<string>();
  readonly subjects = input.required<readonly Subject[]>();
  /** Les mouvements déjà lus, par compte. */
  readonly lines = input.required<ReadonlyMap<string, SubjectLines>>();
  readonly totals = input.required<GeneralLedgerFigures>();
  readonly decimals = input(0);
  readonly currency = input('');

  /** Une carte arrive à l'écran : ses mouvements sont à lire. */
  readonly shown = output<Subject>();
  /** Tous les mouvements d'un compte, dans la vue tableau. */
  readonly openAll = output<Subject>();
  /** Les mouvements d'une carte n'ont pas pu être lus : réessayer. */
  readonly retry = output<Subject>();

  protected readonly cardLines = CARD_LINES;

  /** Le nom d'une carte, sans le code qu'elle montre déjà en grand. */
  protected cardName(subject: Subject): string {
    const prefix = `${subject.code} `;
    return subject.label.startsWith(prefix) ? subject.label.slice(prefix.length) : subject.label;
  }

  protected isZero(amount: string): boolean {
    return Number(amount) === 0;
  }

  protected date(value: string | null | undefined): string {
    return value ? day(value) : '';
  }
}
