import { ErrorCatalog } from '../../core/errors/user-error';
import { APP_ROOT } from '../../core/navigation/applications';
import { DistributionShare } from './data-access/analytics-models';

/** Words of the analytics API's values: no rule is decided here. */

const ANALYTIQUE = `${APP_ROOT}/comptabilite/analytique`;

/** The page of a plan, from anywhere. */
export const planUrl = (planId: string) => `${ANALYTIQUE}/plans/${planId}`;

/** A new distribution model. */
export const NEW_RULE_URL = `${ANALYTIQUE}/regles/nouveau`;

/** « KIPE 70 %, RATOMA 30 % »: a distribution in a few words. */
export function distributionText(shares: readonly DistributionShare[]): string {
  return shares.map((share) => `${share.code} ${percentText(share.percentage)}`).join(', ');
}

/** « 33,3333 % », « 70 % »: a percentage without its useless zeros. */
export function percentText(percentage: string): string {
  const [whole, fraction = ''] = percentage.split('.');
  const kept = fraction.replace(/0+$/, '');
  return `${whole}${kept ? `,${kept}` : ''} %`;
}

/** Each plan's total, to say which one is not at 100 %. */
export function planTotals(
  shares: readonly { axis: string; percentage: string }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const share of shares) {
    // Hundredths of a percent, as integers: no floating sum.
    const hundredths = Math.round(Number(share.percentage) * 10000);
    totals.set(share.axis, (totals.get(share.axis) ?? 0) + hundredths);
  }
  return totals;
}

export const ANALYTIC_ERRORS: ErrorCatalog = {
  analytic_axis_code_exists: {
    title: 'Ce code de plan existe déjà.',
    message: 'Choisissez un autre code.',
  },
  analytic_value_code_exists: {
    title: 'Ce code de compte analytique existe déjà dans le plan.',
    message: 'Choisissez un autre code.',
  },
  analytic_rule_code_exists: {
    title: 'Ce code de modèle existe déjà.',
    message: 'Choisissez un autre code.',
  },
  analytic_axis_inactive: {
    title: 'Le plan est désactivé.',
    message: 'Réactivez-le ou choisissez un autre plan.',
  },
  analytic_value_inactive: {
    title: 'Un compte analytique est désactivé.',
    message: 'Choisissez un compte actif.',
  },
  analytic_axis_mismatch: {
    title: 'Un compte analytique n’est pas de ce plan.',
    message: 'Un modèle répartit sur les comptes d’un seul plan.',
  },
  analytic_value_repeated: {
    title: 'Un compte analytique revient deux fois.',
    message: 'Gardez-le une seule fois.',
  },
  analytic_percentage_total: {
    title: 'La répartition d’un plan ne fait pas 100 %.',
    message: 'Les pourcentages de chaque plan doivent faire 100 % exactement.',
  },
  analytic_precision_exceeded: {
    title: 'Un pourcentage a trop de décimales.',
    message: 'Quatre décimales au plus (ex. 33,3333).',
  },
  analytic_negative_share: {
    title: 'Un pourcentage est négatif.',
    message: 'Saisissez un pourcentage positif.',
  },
  analytic_allocation_empty: {
    title: 'La répartition est vide.',
    message: 'Ajoutez au moins un compte analytique.',
  },
  analytic_account_prefix_invalid: {
    title: 'Le début de compte n’est pas valable.',
    message: 'Saisissez les premiers chiffres des comptes (ex. 62 ou 6011).',
  },
};
