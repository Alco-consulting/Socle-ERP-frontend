import { ErrorCatalog } from '../../../core/errors/user-error';
import { BalanceSheet, BalanceSheetBlock, StatementAccount } from '../data-access/reporting-models';
import {
  SheetBlock,
  SheetFoot,
  SheetLink,
  SheetPair,
  nonZero,
} from '../statement-sheet/statement-sheet';

/** A block as shown: its accounts, none at zero, then the year's result where it is held. */
function shown(
  block: BalanceSheetBlock,
  resultName: string,
  link: (account: StatementAccount) => SheetLink,
  resultLink: SheetLink,
): SheetBlock {
  const rows = block.accounts
    .filter((account) => nonZero(account.amount))
    .map((account) => ({
      key: account.public_id,
      code: account.code,
      name: account.name,
      amount: account.amount,
      link: link(account),
    }));
  const result =
    block.result !== null && nonZero(block.result)
      ? [{ key: 'result', code: '', name: resultName, amount: block.result, link: resultLink }]
      : [];
  return { key: block.code, name: block.name, total: block.total, rows: [...rows, ...result] };
}

/** The blocks of a row face to face: Actif immobilisé and Capitaux propres first. */
export function sheetPairs(
  sheet: BalanceSheet,
  link: (account: StatementAccount) => SheetLink,
  resultLink: SheetLink,
): readonly SheetPair[] {
  const blocks = [...sheet.assets.blocks, ...sheet.liabilities.blocks];
  const rows = [...new Set(blocks.map((block) => block.row))].sort((a, b) => a - b);
  const at = (side: readonly BalanceSheetBlock[], row: number) => {
    const block = side.find((item) => item.row === row);
    return block ? shown(block, sheet.result_name, link, resultLink) : null;
  };
  return rows.map((row) => ({
    key: `row-${row}`,
    left: at(sheet.assets.blocks, row),
    right: at(sheet.liabilities.blocks, row),
  }));
}

export function sheetFoot(sheet: BalanceSheet): readonly SheetFoot[] {
  return [
    {
      key: 'total',
      kind: 'total',
      left: { label: 'Total actif', amount: sheet.assets.total },
      right: { label: 'Total passif', amount: sheet.liabilities.total },
    },
  ];
}

/** Reporting's errors of the bilan, by code. */
export const BALANCE_SHEET_ERRORS: ErrorCatalog = {
  reporting_scope_required: {
    title: 'Choisissez une période.',
    message: 'Le bilan se lit à la fin d’une période d’un exercice.',
  },
  reporting_scope_invalid: {
    title: 'Ces dates ne conviennent pas au bilan.',
    message:
      'La période doit tenir dans un exercice. Un exercice s’ouvre à la première écriture de son année.',
  },
  reporting_balance_sheet_unavailable: {
    title: 'Pas de bilan pour cette société.',
    message: 'Il suit le plan SYSCOHADA, que cette société n’utilise pas.',
  },
};
