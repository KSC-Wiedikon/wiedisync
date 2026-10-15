// Typed contract for finance-values.js (frontend alias `@finance-values`).
export type InvoiceStatus = 'open' | 'pending_confirmation' | 'partial' | 'paid' | 'cancelled'
  | 'paid_partially_written_off' | 'written_off' | 'draft'
export const NATIVE_INVOICE_STATUSES: InvoiceStatus[]
export const INVOICE_STATUS_VALUES: InvoiceStatus[]
export const INVOICE_PAID_STATUSES: InvoiceStatus[]
export function normalizeInvoiceStatus(v: unknown): InvoiceStatus | null
export function invoiceStatusToClubdesk(v: unknown): string

export type EntryType = 'standard' | 'invoice' | 'invoice_collective' | 'invoice_collective_item' | 'opening' | 'closing' | 'reversal'
export const ENTRY_TYPE_VALUES: EntryType[]
export const YEAR_END_ENTRY_TYPES: EntryType[]
export const RECEIPT_EXEMPT_ENTRY_TYPES: EntryType[]
export function normalizeEntryType(v: unknown): EntryType | null
export function entryTypeLabel(v: unknown): string

export const PAYMENT_METHOD_VALUES: string[]
export function normalizePaymentMethod(v: unknown): string | null
export function paymentMethodLabel(v: unknown): string

export function dunningLevelFromText(v: unknown): number
