import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { APP_ROOT } from '../../../core/navigation/applications';
import { AlcoAmountPipe } from '../../../shared/pipes/amount.pipe';
import { GENERAL_LEDGER_PARAM, LEDGER_PATHS } from '../general-ledger/general-ledger-presentation';
import { PERIOD_PARAM, Period } from '../report-period/report-period';

/** Where a row leads: an account's general ledger, the year's result's statement. */
export interface SheetLink {
  readonly url: string;
  readonly query: Readonly<Record<string, string>>;
}

/** A row of a block: an account, or a line of the report's own (the year's result). */
export interface SheetRow {
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly amount: string;
  readonly link: SheetLink | null;
}

export interface SheetBlock {
  readonly key: string;
  readonly name: string;
  readonly total: string;
  readonly rows: readonly SheetRow[];
}

/** Blocks facing each other; `null`: an empty place on that side. */
export interface SheetPair {
  readonly key: string;
  readonly left: SheetBlock | null;
  readonly right: SheetBlock | null;
}

export interface SheetCell {
  readonly label: string;
  /** `null`: the label alone (a profit when there is a loss). */
  readonly amount: string | null;
}

/** A closing line of both sides: the result, or each side's total on the logo's navy. */
export interface SheetFoot {
  readonly key: string;
  readonly kind: 'result' | 'total';
  readonly left: SheetCell;
  readonly right: SheetCell;
}

/** An amount of the server is shown unless it is zero. */
export const nonZero = (amount: string) => Number(amount) !== 0;

/** A report of Analyse, on given dates (`analyse/resultat`, the general ledger…). */
export function analysisLink(
  path: string,
  dates: Period,
  query: Record<string, string> = {},
): SheetLink {
  return {
    url: `${APP_ROOT}/comptabilite/${path}`,
    query: {
      ...query,
      [PERIOD_PARAM.period]: 'perso',
      [PERIOD_PARAM.from]: dates.from,
      [PERIOD_PARAM.to]: dates.to,
    },
  };
}

/** The general ledger of an account, on the same dates. */
export function ledgerLink(code: string, dates: Period): SheetLink {
  return analysisLink(LEDGER_PATHS.account, dates, { [GENERAL_LEDGER_PARAM.account]: code });
}

/**
 * A report in two sides (Compte de résultat, Bilan; notes backend 0055, 0056): each block
 * facing its own, its total on its title, its rows under it, then the closing lines; one
 * column on a phone, the left side first. Every figure is the server's.
 */
@Component({
  selector: 'alco-statement-sheet',
  imports: [NgTemplateOutlet, RouterLink, AlcoAmountPipe],
  templateUrl: './statement-sheet.html',
  styleUrl: './statement-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoStatementSheet {
  readonly left = input.required<string>();
  readonly right = input.required<string>();
  readonly pairs = input.required<readonly SheetPair[]>();
  readonly foot = input<readonly SheetFoot[]>([]);
  readonly decimals = input(0);

  protected isNegative(amount: string): boolean {
    return amount.startsWith('-') && nonZero(amount);
  }
}
