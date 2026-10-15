// Finance value vocabulary (phase 3 of the English-only DB migration,
// migration 419): the English slugs the finance tables store and the ClubDesk
// wording they meet at the border.
//
// Dependency-free ESM like member-values.js: kscw-endpoints and the frontend
// (`@finance-values`) import this one copy. The SQL twins are cd_to_app() /
// app_to_cd() over clubdesk_value_map, domains invoice_status, booking_type
// and payment_method (migrations 412 + 419) — a unit test reads both.
//
// The ClubDesk finance mirror is rebuilt nightly by
// directus/scripts/import-clubdesk-finance.mjs, which translates in SQL
// (cd_to_app) — it runs in a bare node container that cannot import this file.
//
// Display rule (decision 15.10.2026): pages, PDFs, CSV exports and emails keep
// printing the ClubDesk wording for mirror rows and booking types; only the
// stored value changed.

const trim = (v) => String(v ?? '').trim()
// Matching like cd_to_app(): case- and whitespace-blind.
const key = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, '')

// ── finance_invoices.status ─────────────────────────────────────────────────
// One vocabulary for both sources. Native invoices use the first five (CHECK
// finance_invoices_native_status_check); ClubDesk mirror rows map onto the same
// slugs where the meaning is the same, plus three ClubDesk-only states.
export const NATIVE_INVOICE_STATUSES = ['open', 'pending_confirmation', 'partial', 'paid', 'cancelled']
export const INVOICE_STATUS_VALUES = [...NATIVE_INVOICE_STATUSES, 'paid_partially_written_off', 'written_off', 'draft']
const INVOICE_STATUS_CD = {
  open: 'Gestellt',
  partial: 'Teilweise bezahlt',
  paid: 'Bezahlt',
  paid_partially_written_off: 'Bezahlt (teilw. abgeschrieben)',
  cancelled: 'Storniert',
  written_off: 'Abgeschrieben',
  draft: 'Entwurf',
}
const INVOICE_STATUS_IN = new Map([
  ...INVOICE_STATUS_VALUES.map((s) => [key(s), s]),
  ...Object.entries(INVOICE_STATUS_CD).map(([slug, cd]) => [key(cd), slug]),
])
/** ClubDesk's "Bezahlt…": settled, possibly with the rest written off. */
export const INVOICE_PAID_STATUSES = ['paid', 'paid_partially_written_off']
/** Slug or ClubDesk wording → slug, or null when unknown. */
export function normalizeInvoiceStatus(v) { return INVOICE_STATUS_IN.get(key(v)) ?? null }
/** Slug → ClubDesk's wording ('Bezahlt' …); an unknown value is returned trimmed. */
export function invoiceStatusToClubdesk(v) {
  const s = normalizeInvoiceStatus(v)
  return (s && INVOICE_STATUS_CD[s]) || trim(v)
}

// ── finance_transactions.entry_type (was typ) ───────────────────────────────
export const ENTRY_TYPE_VALUES = ['standard', 'invoice', 'invoice_collective', 'invoice_collective_item', 'opening', 'closing', 'reversal']
const ENTRY_TYPE_CD = {
  standard: 'Standard',
  invoice: 'Rechnung',
  invoice_collective: 'Rechnung (Sammel)',
  invoice_collective_item: 'Rechnung (Sammelposition)',
  opening: 'Eröffnung',
  closing: 'Abschluss',
  reversal: 'Storno',
}
const ENTRY_TYPE_IN = new Map([
  ...ENTRY_TYPE_VALUES.map((s) => [key(s), s]),
  ...Object.entries(ENTRY_TYPE_CD).map(([slug, cd]) => [key(cd), slug]),
  [key('Eroeffnung'), 'opening'], // what native year-end closes wrote until 419
])
/** Year-end bookings: left out of the income statement. */
export const YEAR_END_ENTRY_TYPES = ['opening', 'closing']
/** Entries no receipt is expected for: the year-end close, and a reversal
 *  (its receipt is its original's). */
export const RECEIPT_EXEMPT_ENTRY_TYPES = ['opening', 'closing', 'reversal']
export function normalizeEntryType(v) { return ENTRY_TYPE_IN.get(key(v)) ?? null }
/** Slug → ClubDesk's Typ ('Eröffnung', 'Storno' …); an unknown value is returned trimmed. */
export function entryTypeLabel(v) {
  const s = normalizeEntryType(v)
  return (s && ENTRY_TYPE_CD[s]) || trim(v)
}

// ── finance_invoices.payment_method (ClubDesk "Zahlungsart") ────────────────
// Only what the export has carried so far; an unknown ClubDesk value is
// imported verbatim and shows up in the importer's warning.
const PAYMENT_METHOD_CD = {
  qr_bill_no_reference: 'QR-Rechnung ohne Referenz',
}
export const PAYMENT_METHOD_VALUES = Object.keys(PAYMENT_METHOD_CD)
const PAYMENT_METHOD_IN = new Map([
  ...PAYMENT_METHOD_VALUES.map((s) => [key(s), s]),
  ...Object.entries(PAYMENT_METHOD_CD).map(([slug, cd]) => [key(cd), slug]),
])
export function normalizePaymentMethod(v) { return PAYMENT_METHOD_IN.get(key(v)) ?? null }
export function paymentMethodLabel(v) {
  const s = normalizePaymentMethod(v)
  return (s && PAYMENT_METHOD_CD[s]) || trim(v)
}

// ── dunning (finance_invoices.dunning_level; dunning_status dropped in 419) ──
/** ClubDesk's Mahnstatus ('1. Mahnung') or the old native 'Mahnung 1' → level; '' → 0.
 *  Twin of dunningLevel() in directus/scripts/import-clubdesk-finance.mjs. */
export function dunningLevelFromText(v) {
  const m = trim(v).match(/(\d+)/)
  return m ? Number(m[1]) : 0
}
