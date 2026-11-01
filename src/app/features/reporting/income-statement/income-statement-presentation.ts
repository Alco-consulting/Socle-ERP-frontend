import { ErrorCatalog } from '../../../core/errors/user-error';
import { IncomeStatement, StatementAccount, StatementBlock } from '../data-access/reporting-models';
import {
  SheetBlock,
  SheetFoot,
  SheetLink,
  SheetPair,
  nonZero,
} from '../statement-sheet/statement-sheet';

/** A block as shown: its title, its total, then its accounts themselves, none at zero. */
function shown(block: StatementBlock, link: (account: StatementAccount) => SheetLink): SheetBlock {
  return {
    key: block.code,
    name: block.name,
    total: block.total,
    rows: block.lines
      .flatMap((line) => line.accounts)
      .filter((account) => nonZero(account.amount))
      .map((account) => ({
        key: account.public_id,
        code: account.code,
        name: account.name,
        amount: account.amount,
        link: link(account),
      })),
  };
}

/** The blocks face to face (exploitation, financier, HAO), the others after them. */
export function incomePairs(
  statement: IncomeStatement,
  link: (account: StatementAccount) => SheetLink,
): readonly SheetPair[] {
  const products = new Map(
    statement.products.blocks.map((block) => [block.code, shown(block, link)]),
  );
  const pairs: SheetPair[] = statement.charges.blocks.map((block) => {
    const facing = products.get(block.code) ?? null;
    products.delete(block.code);
    return { key: block.code, left: shown(block, link), right: facing };
  });
  for (const [code, block] of products) {
    pairs.push({ key: code, left: null, right: block });
  }
  return pairs;
}

/** The profit with the charges, the loss with the products, then both totals. */
export function incomeFoot(statement: IncomeStatement): readonly SheetFoot[] {
  return [
    {
      key: 'result',
      kind: 'result',
      left: { label: 'Bénéfice', amount: nonZero(statement.profit) ? statement.profit : null },
      right: { label: 'Perte', amount: nonZero(statement.loss) ? statement.loss : null },
    },
    {
      key: 'total',
      kind: 'total',
      left: { label: 'Total', amount: statement.total },
      right: { label: 'Total', amount: statement.total },
    },
  ];
}

/** Reporting's errors of the compte de résultat, by code. */
export const INCOME_STATEMENT_ERRORS: ErrorCatalog = {
  reporting_scope_required: {
    title: 'Choisissez une période.',
    message: 'Le compte de résultat se lit sur une période d’un exercice.',
  },
  reporting_scope_invalid: {
    title: 'Ces dates ne conviennent pas au compte de résultat.',
    message:
      'La période doit tenir dans un exercice. Un exercice s’ouvre à la première écriture de son année.',
  },
  reporting_income_statement_unavailable: {
    title: 'Pas de compte de résultat pour cette société.',
    message: 'Il suit le plan SYSCOHADA, que cette société n’utilise pas.',
  },
};
