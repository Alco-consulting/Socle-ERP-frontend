import { AlcoBalanceSidesPipe, NO_SIDES, balanceSides } from './balance-sides';

describe('balanceSides : un solde sur deux colonnes', () => {
  it('positif : solde débiteur', () => {
    expect(balanceSides('15252000.00')).toEqual({ debit: '15252000.00', credit: null });
  });

  it('négatif : solde créditeur, sans le signe', () => {
    expect(balanceSides('-16019000.00')).toEqual({ debit: null, credit: '16019000.00' });
  });

  it('nul, vide ou absent : aucune des deux colonnes', () => {
    expect(balanceSides('0.00')).toBe(NO_SIDES);
    expect(balanceSides('-0.00')).toBe(NO_SIDES);
    expect(balanceSides('')).toBe(NO_SIDES);
    expect(balanceSides(null)).toBe(NO_SIDES);
    expect(balanceSides(undefined)).toBe(NO_SIDES);
  });

  it('le chiffre reste celui du serveur, à l’identique', () => {
    expect(balanceSides('+700000.50').debit).toBe('700000.50');
    expect(balanceSides(' -4455000 ').credit).toBe('4455000');
  });

  it('le pipe rend la même chose', () => {
    expect(new AlcoBalanceSidesPipe().transform('-2000000')).toEqual({
      debit: null,
      credit: '2000000',
    });
  });
});
