import { ErrorCatalog } from '../../../core/errors/user-error';
import { IncomeStatement, StatementAccount, StatementBlock } from '../data-access/reporting-models';

/** A block as shown: its title, its total, then its accounts themselves. */
export interface ShownBlock {
  readonly code: string;
  readonly name: string;
  readonly total: string;
  readonly accounts: readonly StatementAccount[];
}

/** A row of the sheet: a block of charges facing the block of products of the same code. */
export interface BlockPair {
  readonly code: string;
  readonly charges: ShownBlock | null;
  readonly products: ShownBlock | null;
}

const nonZero = (item: { readonly amount: string }) => Number(item.amount) !== 0;

/** The accounts of a block, without their two-digit lines; those at zero left out. */
function shown(block: StatementBlock): ShownBlock {
  return {
    code: block.code,
    name: block.name,
    total: block.total,
    accounts: block.lines.flatMap((line) => line.accounts).filter(nonZero),
  };
}

/** The blocks face to face (exploitation, financier, HAO), the others after them. */
export function blockPairs(statement: IncomeStatement): readonly BlockPair[] {
  const products = new Map(statement.products.blocks.map((block) => [block.code, shown(block)]));
  const pairs: BlockPair[] = statement.charges.blocks.map(shown).map((block) => {
    const facing = products.get(block.code) ?? null;
    products.delete(block.code);
    return { code: block.code, charges: block, products: facing };
  });
  for (const block of products.values()) {
    pairs.push({ code: block.code, charges: null, products: block });
  }
  return pairs;
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
