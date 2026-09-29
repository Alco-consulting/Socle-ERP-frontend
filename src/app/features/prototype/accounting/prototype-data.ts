/**
 * PROTOTYPE — fictitious data. No real company, partner or amount: every name carries
 * « (démo) » and the screens show the prototype banner. Deleted with the prototype.
 */
import { sumDecimals } from '../../../shared/utils/decimal';
import {
  Account,
  Entry,
  EntryAction,
  EntryLine,
  EntryStatus,
  Journal,
  Partner,
} from './prototype-models';

export const CURRENCY = 'GNF';
/** GNF has no minor unit in practice: amounts are integers. */
export const CURRENCY_DECIMALS = 0;

export const JOURNALS: readonly Journal[] = [
  { code: 'ACH', name: 'Achats' },
  { code: 'VTE', name: 'Ventes' },
  { code: 'BQ1', name: 'Banque principale' },
  { code: 'CAI', name: 'Caisse' },
  { code: 'OD', name: 'Opérations diverses' },
];

export const ACCOUNTS: readonly Account[] = [
  { code: '401100', name: 'Fournisseurs' },
  { code: '411100', name: 'Clients' },
  { code: '443100', name: 'TVA facturée' },
  { code: '445200', name: 'TVA récupérable' },
  { code: '521100', name: 'Banque principale' },
  { code: '571100', name: 'Caisse' },
  { code: '601100', name: 'Achats de marchandises' },
  { code: '605100', name: 'Fournitures' },
  { code: '622100', name: 'Locations' },
  { code: '701100', name: 'Ventes de marchandises' },
  { code: '706100', name: 'Services vendus' },
];

const partner = (
  id: string,
  code: string,
  name: string,
  role: 'customer' | 'supplier',
  city: string,
): Partner => ({
  id,
  code,
  name,
  customer: role === 'customer',
  supplier: role === 'supplier',
  country: 'GN',
  city,
});

export const PARTNERS: readonly Partner[] = [
  partner('p-c1', 'CLI-001', 'Client Alpha (démo)', 'customer', 'Conakry'),
  partner('p-c2', 'CLI-002', 'Client Bêta (démo)', 'customer', 'Kindia'),
  partner('p-c3', 'CLI-003', 'Client Gamma (démo)', 'customer', 'Conakry'),
  partner('p-f1', 'FOU-001', 'Fournisseur Delta (démo)', 'supplier', 'Conakry'),
  partner('p-f2', 'FOU-002', 'Fournisseur Epsilon (démo)', 'supplier', 'Boké'),
  partner('p-f3', 'FOU-003', 'Bailleur Zêta (démo)', 'supplier', 'Conakry'),
];

const AMOUNTS = [250000, 1200000, 480000, 75000, 3600000, 150000, 920000, 2150000, 640000];

interface Template {
  readonly journal: string;
  readonly reference: string;
  readonly label: (partner: string) => string;
  readonly partners: readonly string[];
  readonly lines: (amount: number, label: string) => EntryLine[];
}

const line = (account: string, label: string, debit: number, credit: number): EntryLine => ({
  account,
  label,
  debit: debit ? String(debit) : '',
  credit: credit ? String(credit) : '',
});

const vat = (amount: number) => (amount * 18) / 100;

const TEMPLATES: readonly Template[] = [
  {
    journal: 'ACH',
    reference: 'FAF',
    label: (partner) => `Facture d’achat — ${partner}`,
    partners: ['p-f1', 'p-f2'],
    lines: (amount, label) => [
      line('601100', label, amount, 0),
      line('445200', 'TVA récupérable 18 %', vat(amount), 0),
      line('401100', label, 0, amount + vat(amount)),
    ],
  },
  {
    journal: 'VTE',
    reference: 'FAC',
    label: (partner) => `Facture de vente — ${partner}`,
    partners: ['p-c1', 'p-c2', 'p-c3'],
    lines: (amount, label) => [
      line('411100', label, amount + vat(amount), 0),
      line('701100', label, 0, amount),
      line('443100', 'TVA facturée 18 %', 0, vat(amount)),
    ],
  },
  {
    journal: 'BQ1',
    reference: 'VIR',
    label: (partner) => `Règlement reçu — ${partner}`,
    partners: ['p-c1', 'p-c2'],
    lines: (amount, label) => [line('521100', label, amount, 0), line('411100', label, 0, amount)],
  },
  {
    journal: 'CAI',
    reference: 'PC',
    label: () => 'Achat de fournitures de bureau',
    partners: [],
    lines: (amount, label) => [
      line('605100', label, Math.round(amount / 10), 0),
      line('571100', label, 0, Math.round(amount / 10)),
    ],
  },
  {
    journal: 'BQ1',
    reference: 'VIR',
    label: (partner) => `Paiement fournisseur — ${partner}`,
    partners: ['p-f1', 'p-f2'],
    lines: (amount, label) => [line('401100', label, amount, 0), line('521100', label, 0, amount)],
  },
  {
    journal: 'OD',
    reference: 'OD',
    label: (partner) => `Loyer des bureaux — ${partner}`,
    partners: ['p-f3'],
    lines: (amount, label) => [line('622100', label, amount, 0), line('401100', label, 0, amount)],
  },
];

export function actionsFor(status: EntryStatus): readonly EntryAction[] {
  switch (status) {
    case 'draft':
      return ['save', 'validate', 'delete', 'duplicate'];
    case 'submitted':
      return ['validate', 'duplicate'];
    case 'validated':
      return ['reverse', 'duplicate'];
    case 'locked':
      return ['duplicate'];
  }
}

export function totalDebit(lines: readonly EntryLine[]): string {
  return sumDecimals(lines.map((item) => item.debit));
}

/** 5 locked entries (August, closed period) then 45 entries in September 2026. */
export function buildEntries(): Entry[] {
  const entries: Entry[] = [];
  for (let i = 0; i < 50; i++) {
    const template = TEMPLATES[i % TEMPLATES.length];
    const amount = AMOUNTS[(i * 7) % AMOUNTS.length];
    const partnerId =
      template.partners.length > 0 ? template.partners[i % template.partners.length] : null;
    const partner = PARTNERS.find((item) => item.id === partnerId)?.name ?? '';
    const label = template.label(partner);
    const august = i < 5;
    const day = august ? 25 + i : 1 + Math.floor(((i - 5) * 27) / 45);
    const date = `2026-${august ? '08' : '09'}-${String(day).padStart(2, '0')}`;
    const status: EntryStatus = august
      ? 'locked'
      : i >= 38
        ? 'draft'
        : i % 9 === 0
          ? 'submitted'
          : 'validated';
    let lines = template.lines(amount, label);
    if (i === 49) {
      // One unbalanced draft, to show the server's refusal and its human message.
      lines = [line('601100', label, 1150000, 0), line('401100', label, 0, 1180000)];
    }
    entries.push({
      id: `proto-${String(i + 1).padStart(3, '0')}`,
      number: `EC-2026-${String(96 + i).padStart(6, '0')}`,
      date,
      journal: template.journal,
      reference: `${template.reference}-2026-${String(40 + i).padStart(4, '0')}`,
      label,
      partnerId,
      currency: CURRENCY,
      status,
      total: totalDebit(lines),
      lines,
      note: '',
      actions: actionsFor(status),
    });
  }
  return entries;
}

export function journalName(code: string): string {
  return JOURNALS.find((journal) => journal.code === code)?.name ?? code;
}

export function partnerName(id: string | null): string {
  return id ? (PARTNERS.find((partner) => partner.id === id)?.name ?? '') : '';
}
