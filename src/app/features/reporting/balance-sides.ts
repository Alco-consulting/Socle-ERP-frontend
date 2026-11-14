import { Pipe, PipeTransform } from '@angular/core';

/**
 * Un solde présenté sur deux colonnes, comme dans une balance à six colonnes : débiteur s'il est
 * positif, créditeur s'il est négatif, sans signe ; aucune des deux s'il est nul.
 */
export interface BalanceSides {
  readonly debit: string | null;
  readonly credit: string | null;
}

/** Sans solde : les deux colonnes vides. */
export const NO_SIDES: BalanceSides = { debit: null, credit: null };

/**
 * Le côté d'un montant du serveur (« -16019000.00 » → créditeur « 16019000.00 »). Seul le signe
 * est lu : le chiffre reste celui du serveur, aucun calcul n'est fait.
 */
export function balanceSides(amount: string | null | undefined): BalanceSides {
  const value = (amount ?? '').trim();
  if (value === '' || Number(value) === 0) {
    return NO_SIDES;
  }
  return value.startsWith('-')
    ? { debit: null, credit: value.slice(1) }
    : { debit: value.replace(/^\+/, ''), credit: null };
}

/** `{{ montant | balanceSides }}` : les deux colonnes d'un solde, dans un gabarit. */
@Pipe({ name: 'balanceSides' })
export class AlcoBalanceSidesPipe implements PipeTransform {
  transform(amount: string | null | undefined): BalanceSides {
    return balanceSides(amount);
  }
}
