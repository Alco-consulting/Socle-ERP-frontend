import { Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

import { ErrorCatalog } from '../../core/errors/user-error';
import { SessionStore } from '../../core/session/session.store';
import { BadgeTone } from '../../shared/ui/badge/badge';
import { IconName } from '../../shared/ui/icon/icons';
import { WorkflowStep } from '../../shared/ui/workflow-steps/workflow-steps';
import { CurrenciesApi } from '../currencies/data-access/currencies-api';
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
};

/** The decimals of the company's reference currency (GNF: none), read once. */
export function referencePlaces(): Signal<number> {
  const currency = inject(SessionStore).activeCompany()?.currency ?? '';
  return toSignal(
    inject(CurrenciesApi)
      .currencies()
      .pipe(
        map((page) => page.results.find((item) => item.code === currency)?.decimal_places ?? 0),
        catchError(() => of(0)),
      ),
    { initialValue: 0 },
  );
}
