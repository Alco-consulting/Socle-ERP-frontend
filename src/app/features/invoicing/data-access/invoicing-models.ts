/** The invoicing API (note backend 0038): `invoicing/products/`, `invoicing/invoices/`. */

export type RecordStatus = 'active' | 'inactive';

/** `InvoicingNamedReference`: an account, a partner, a journal or a product. */
export interface NamedReference {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
}

/** `InvoicingTaxReference`. */
export interface TaxReference extends NamedReference {
  readonly rate: string;
}

/** `InvoicingProduct`. */
export interface Product {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly sale_price: string | null;
  readonly sale_account: NamedReference | null;
  readonly purchase_account: NamedReference | null;
  readonly tax: TaxReference;
  readonly status: RecordStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

/** `InvoicingProductWriteRequest`: accounts and tax by their public id. */
export interface ProductWrite {
  readonly code?: string;
  readonly name: string;
  readonly sale_price?: string | null;
  readonly sale_account?: string | null;
  readonly purchase_account?: string | null;
  readonly tax: string;
}

export interface ProductQuery {
  readonly search?: string;
  readonly status?: RecordStatus | null;
  readonly page?: number;
}

export type InvoiceKind =
  'customer_invoice' | 'customer_credit_note' | 'supplier_invoice' | 'supplier_credit_note';
export type InvoiceStatus = 'draft' | 'posted' | 'cancelled';
export type PaymentState = 'not_paid' | 'partial' | 'paid';

/** `InvoicingInvoiceLine`. */
export interface InvoiceLine {
  readonly sequence: number;
  readonly product: NamedReference;
  readonly description: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly tax: TaxReference;
  readonly amount_untaxed: string;
  /** The account posted; on a draft, the product's account of the side. */
  readonly account: NamedReference | null;
}

/** `InvoicingInvoiceTax`: one line per tax. */
export interface InvoiceTax {
  readonly sequence: number;
  readonly tax: TaxReference;
  readonly rate: string;
  readonly base: string;
  readonly amount: string;
  readonly account: NamedReference | null;
}

export interface EntryReference {
  readonly public_id: string;
  readonly entry_number: string;
}

/** `InvoicingInvoiceSummary`: a row of the list. */
export interface InvoiceSummary {
  readonly public_id: string;
  readonly kind: InvoiceKind;
  readonly status: InvoiceStatus;
  readonly number: string;
  readonly partner: NamedReference;
  readonly invoice_date: string;
  readonly journal: NamedReference;
  readonly currency: string;
  readonly reference: string;
  readonly origin: string | null;
  readonly amount_untaxed: string;
  readonly amount_tax: string;
  readonly amount_total: string;
  readonly payment_state: PaymentState | null;
  readonly amount_residual: string | null;
}

/** `InvoicingInvoicePartner`: the partner of the record, with its address. */
export interface InvoicePartner extends NamedReference {
  readonly address: string;
  readonly city: string;
  /** ISO 3166-1 alpha-2 (GN). */
  readonly country: string;
  readonly phone: string;
}

/** `InvoicingSettlement`: a payment or a credit note lettered with the invoice. */
export interface Settlement {
  readonly lettering: string;
  readonly date: string;
  /** Settled on this invoice. */
  readonly amount: string;
  readonly credit_note: {
    readonly public_id: string;
    readonly kind: InvoiceKind;
    readonly number: string;
  } | null;
}

/** `InvoicingInvoice`. */
export interface Invoice extends Omit<InvoiceSummary, 'partner'> {
  readonly partner: InvoicePartner;
  readonly lines: readonly InvoiceLine[];
  readonly taxes: readonly InvoiceTax[];
  readonly entry: EntryReference | null;
  readonly cancellation_entry: EntryReference | null;
  readonly cancellation_reason: string;
  /** Posted only: oldest first. */
  readonly settlements: readonly Settlement[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly posted_at: string | null;
  readonly cancelled_at: string | null;
}

/** `InvoicingLineWriteRequest`: absent price, description, tax: the product's. */
export interface InvoiceLineWrite {
  readonly product: string;
  readonly quantity: string;
  readonly unit_price?: string | null;
  readonly description?: string;
  readonly tax?: string | null;
}

/** `InvoicingInvoiceWriteRequest`: a draft invoice (a credit note comes from its invoice). */
export interface InvoiceWrite {
  readonly kind: 'customer_invoice' | 'supplier_invoice';
  readonly partner: string;
  readonly invoice_date: string;
  readonly journal?: string | null;
  readonly reference?: string;
  readonly lines: readonly InvoiceLineWrite[];
}

/** `PatchedInvoicingInvoiceUpdateRequest`: the lines given replace them all. */
export interface InvoiceUpdate {
  readonly partner?: string;
  readonly invoice_date?: string;
  readonly journal?: string;
  readonly reference?: string;
  readonly lines?: readonly InvoiceLineWrite[];
}

export interface InvoiceQuery {
  readonly kind: InvoiceKind;
  readonly status?: InvoiceStatus | null;
  readonly search?: string;
  readonly page?: number;
}
