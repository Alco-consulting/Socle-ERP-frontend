import { ErrorCatalog } from '../../core/errors/user-error';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import { WorkflowStep } from '../../shared/ui/workflow-steps/workflow-steps';
import { DeclarationCommand, DeclarationStatus, VatSide } from './data-access/taxes-models';

/** Words and look of the declarations API's values: no state is decided here. */

export interface Look {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: IconName;
}

export const DECLARATION_STATUS: Readonly<Record<DeclarationStatus, Look>> = {
  draft: { label: 'Brouillon', tone: 'neutral', icon: 'edit' },
  checked: { label: 'Vérifiée', tone: 'info', icon: 'eye' },
  validated: { label: 'Validée', tone: 'primary', icon: 'check' },
  declared: { label: 'Déclarée', tone: 'warning', icon: 'upload' },
  paid: { label: 'Payée', tone: 'success', icon: 'check' },
};

export const DECLARATION_WORKFLOW: readonly WorkflowStep[] = (
  Object.keys(DECLARATION_STATUS) as DeclarationStatus[]
).map((id) => ({ id, label: DECLARATION_STATUS[id].label }));

/** The button of each command, and the permission the server asks for it. */
export const DECLARATION_COMMANDS: Readonly<
  Record<DeclarationCommand, { label: string; permission: string; done: string }>
> = {
  check: { label: 'Vérifier', permission: 'taxes.manage_declarations', done: 'vérifiée' },
  validate: { label: 'Valider', permission: 'taxes.validate_declaration', done: 'validée' },
  declare: { label: 'Marquer déclarée', permission: 'taxes.manage_declarations', done: 'déclarée' },
  'mark-paid': {
    label: 'Marquer payée',
    permission: 'taxes.manage_declarations',
    done: 'marquée payée',
  },
};

export const VAT_SIDES: Readonly<Record<VatSide, string>> = {
  sale: 'Ventes',
  purchase: 'Achats',
};

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** « Mars 2026 » for a whole month, else « 01/03/2026 → 15/03/2026 ». */
export function periodLabel(start: string, end: string): string {
  const [year, month] = start.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (start.endsWith('-01') && end === `${start.slice(0, 8)}${String(last).padStart(2, '0')}`) {
    const text = MONTH.format(new Date(Date.UTC(year, month - 1, 1)));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const day = (iso: string) => iso.split('-').reverse().join('/');
  return `${day(start)} → ${day(end)}`;
}

/** The first and last days of a month (`2026-03` → `2026-03-01`, `2026-03-31`). */
export function monthBounds(month: string): readonly [string, string] {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

/** The month before `today` (`YYYY-MM`): the one usually declared. */
export function previousMonth(today: string): string {
  const [year, month] = today.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export const DECLARATION_ERRORS: ErrorCatalog = {
  tax_declaration_exists: {
    title: 'Ce mois est déjà déclaré.',
    message: 'Une déclaration de TVA existe déjà pour cette période : ouvrez-la dans la liste.',
  },
  invalid_declaration_transition: {
    title: 'Cette étape n’est plus possible.',
    message: 'La déclaration a changé entre-temps : la page est rechargée.',
  },
  tax_declaration_frozen: {
    title: 'La déclaration est validée.',
    message: 'Ses montants ne changent plus.',
  },
  accounting_vat_account_missing: {
    title: 'Un compte de la liquidation manque au plan comptable.',
    message:
      'Créez le compte 4441 « État, TVA due » et le compte 4449 « État, crédit de TVA à reporter », puis validez à nouveau.',
  },
  accounting_vat_journal_missing: {
    title: 'Aucun journal d’opérations diverses actif.',
    message: 'La liquidation de la TVA y est passée : créez ou réactivez ce journal.',
  },
  taxes_declaration_payment_journal_required: {
    title: 'Le journal du paiement manque.',
    message: 'Choisissez le journal de banque ou de caisse d’où la TVA est payée.',
  },
  treasury_vat_payment_journal: {
    title: 'Ce journal ne peut pas payer la TVA.',
    message: 'Choisissez un journal de banque ou de caisse de la société.',
  },
};
