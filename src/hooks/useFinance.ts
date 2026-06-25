// Finance data hooks (migration 114). Read-only mirror of ClubDesk Finanz.
// Members read only their OWN invoices (policy-enforced); Vorstand reads all.

import { useQuery } from '@tanstack/react-query'
import { useCollection } from '../lib/query'
import { useAuth } from './useAuth'
import { kscwApi, fetchAllItems } from '../lib/api'
import type {
  FinanceInvoice, FinanceTransaction, FinanceAccount, FinanceFiscalYear, FinanceImport,
} from '../modules/finance/types'

/** Coerce a Directus numeric (often a string) to a finite number, else 0. */
export function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Swiss CHF formatting: "CHF 1'234.50" (apostrophe thousands, 2 decimals). */
export function formatChf(v: unknown): string {
  return `CHF ${toNum(v).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * The current member's payable invoices: their own (ClubDesk + native) PLUS
 * native invoices billed to a team they lead (coach/captain/TR). Served by the
 * /finance/my-invoices endpoint — a server-side union that sidesteps the M2M
 * policy-walk-returns-empty trap a Directus filter would hit.
 */
export function useMyInvoices() {
  const { user } = useAuth()
  const q = useQuery({
    queryKey: ['finance', 'my-invoices', user?.id ?? null],
    queryFn: () => kscwApi<{ invoices: FinanceInvoice[]; member_id: number }>('/finance/my-invoices'),
    enabled: !!user,
    select: (r) => r.invoices,
  })
  return q
}

// ── Native-invoice write actions (all hit the Vorstand/recipient-gated endpoints) ──

export interface CreateInvoiceInput {
  recipient_type: 'member' | 'team'
  member?: number
  team?: number
  amount: number
  subject: string
  due_date?: string | null
  fee_category?: string | null
}
export const createNativeInvoice = (input: CreateInvoiceInput) =>
  kscwApi<{ invoice: FinanceInvoice }>('/finance/invoices', { method: 'POST', body: input })
export const reportInvoicePaid = (id: string | number, method?: string | null) =>
  kscwApi<{ invoice: FinanceInvoice }>(`/finance/invoices/${id}/report-paid`, { method: 'POST', body: { method: method ?? null } })
export const confirmInvoice = (id: string | number) =>
  kscwApi<{ invoice: FinanceInvoice }>(`/finance/invoices/${id}/confirm`, { method: 'POST' })
export const cancelInvoice = (id: string | number) =>
  kscwApi<{ invoice: FinanceInvoice }>(`/finance/invoices/${id}/cancel`, { method: 'POST' })
export const linkInvoiceMember = (id: string | number, member: number, scope: 'email' | 'invoice' = 'email') =>
  kscwApi<{ ok: true; scope: string; affected: number }>(`/finance/invoices/${id}/link-member`, { method: 'POST', body: { member, scope } })
export const unlinkInvoiceMember = (id: string | number) =>
  kscwApi<{ ok: true; removed: number; cleared: number }>(`/finance/invoices/${id}/link-member`, { method: 'DELETE' })

/** True for a native invoice (created in wiedisync) vs a ClubDesk mirror row. */
export const isNativeInvoice = (inv: FinanceInvoice): boolean => inv.source === 'native'

export interface CamtImportResult {
  summary: { type: string; credits: number; auto_confirmed: number; clubdesk_guesses: number; unmatched: number; duplicates: number; skipped: number }
  details: Array<{ status: string; invoice?: string | null; recipient?: string | null; invoiceStatus?: string | null; amount?: number | null; debtor?: string | null; reference?: string | null; date?: string | null; reason?: string | null }>
}
/** Upload a camt.053/.054 export → reconcile (Vorstand). */
export const importCamt = (xml: string) =>
  kscwApi<CamtImportResult>('/finance/camt-import', { method: 'POST', body: { xml } })

/** All invoices (board only — gated by the Vorstand read policy). */
export function useFinanceInvoices(enabled = true) {
  return useCollection<FinanceInvoice>('finance_invoices', {
    sort: ['-invoice_date'],
    enabled,
    all: true,
  })
}

/** Ledger transactions, optionally scoped to a fiscal year (board only). */
export function useFinanceTransactions(fiscalYearId?: string | null, enabled = true) {
  return useCollection<FinanceTransaction>('finance_transactions', {
    filter: fiscalYearId ? { fiscal_year: { _eq: fiscalYearId } } : undefined,
    sort: ['-booking_date'],
    enabled,
    all: true,
  })
}

/** Chart of accounts (board only). */
export function useFinanceAccounts(enabled = true) {
  return useCollection<FinanceAccount>('finance_accounts', {
    sort: ['number'],
    enabled,
    all: true,
  })
}

/** Fiscal years, newest first (board only). */
export function useFinanceFiscalYears(enabled = true) {
  return useCollection<FinanceFiscalYear>('finance_fiscal_years', {
    sort: ['-starts_on'],
    enabled,
    all: true,
  })
}

/**
 * A member as seen by the finance member explorer (migrations 132/133). Contact +
 * billing picture only — the FINANCE policy field-scopes the members read, so this
 * is what a finance/board user gets back (NOT the full member record).
 */
export interface FinanceMember {
  id: string | number
  first_name: string
  last_name: string
  email?: string | null
  phone?: string | null
  number?: number | null
  anrede?: string | null
  adresse?: string | null
  plz?: string | null
  ort?: string | null
  nationalitaet?: string | null
  sex?: string | null
  birthdate?: string | null
  iban?: string | null
  iban_confirmed?: boolean
  ahv_nummer?: string | null
  beitragskategorie?: string | null
  sektion?: string | null
  kscw_membership_active?: boolean
  wiedisync_active?: boolean
  billing_different?: boolean
  billing_name?: string | null
  billing_email?: string | null
  billing_address?: string | null
  billing_plz?: string | null
  billing_ort?: string | null
  billing_phone?: string | null
  billing_iban?: string | null
}

const FINANCE_MEMBER_FIELDS = [
  'id', 'first_name', 'last_name', 'email', 'phone', 'number',
  'anrede', 'adresse', 'plz', 'ort', 'nationalitaet', 'sex', 'birthdate',
  'iban', 'iban_confirmed', 'ahv_nummer', 'beitragskategorie', 'sektion', 'kscw_membership_active', 'wiedisync_active',
  'billing_different', 'billing_name', 'billing_email', 'billing_address', 'billing_plz', 'billing_ort', 'billing_phone', 'billing_iban',
]

/** All members with their finance/billing fields (finance + board; field-scoped by policy). */
export function useFinanceMembers(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'members'],
    queryFn: () => fetchAllItems<FinanceMember>('members', {
      fields: FINANCE_MEMBER_FIELDS,
      sort: ['last_name', 'first_name'],
    }),
    enabled,
  })
}

/** Private Directus folder invoice PDFs live in (migration 134). Members can't read it. */
export const FINANCE_INVOICE_FOLDER = 'f1a0d0c5-0000-4000-8000-000000000001'

/** An invoice PDF attachment (migration 134). Keyed by clubdesk_id (ClubDesk-mirror, sync-safe) OR invoice (native). */
export interface FinanceInvoiceDocument {
  id: string | number
  file: string
  match_clubdesk_id?: string | null
  invoice?: string | number | null
  label?: string | null
  uploaded_by_name?: string | null
  date_created?: string | null
}

/** All invoice PDF attachments (finance + board). Few rows → fetched whole + mapped client-side. */
export function useFinanceInvoiceDocuments(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'invoice-documents'],
    queryFn: () => fetchAllItems<FinanceInvoiceDocument>('finance_invoice_documents', {
      fields: ['id', 'file', 'match_clubdesk_id', 'invoice', 'label', 'uploaded_by_name', 'date_created'],
      sort: ['-date_created'],
    }),
    enabled,
  })
}

/** A pay-out / reimbursement the club owes a member (migration 137). */
export interface FinancePayout {
  id: string | number
  member?: string | number | null
  amount?: number | string | null
  currency?: string | null
  message?: string | null
  iban?: string | null
  payee_name?: string | null
  payee_address?: string | null
  payee_zip?: string | null
  payee_ort?: string | null
  status?: string | null
  created_by_name?: string | null
  date_created?: string | null
}
const PAYOUT_FIELDS = ['id', 'member', 'amount', 'currency', 'message', 'iban', 'payee_name', 'payee_address', 'payee_zip', 'payee_ort', 'status', 'created_by_name', 'date_created']

/** Pay-outs for one member (finance/board — explorer). */
export function useMemberPayouts(memberId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'payouts', 'member', memberId ?? null],
    queryFn: () => fetchAllItems<FinancePayout>('finance_payouts', { filter: { member: { _eq: memberId } }, fields: PAYOUT_FIELDS, sort: ['-date_created'] }),
    enabled: enabled && memberId != null,
  })
}

/** The current member's own pay-outs (My finances; policy scopes to own). */
export function useMyPayouts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['finance', 'my-payouts', user?.id ?? null],
    queryFn: () => fetchAllItems<FinancePayout>('finance_payouts', { fields: PAYOUT_FIELDS, sort: ['-date_created'] }),
    enabled: !!user,
  })
}

/** Import/sync provenance history, newest first (board only). */
export function useFinanceImports(enabled = true) {
  return useCollection<FinanceImport>('finance_imports', {
    sort: ['-imported_at'],
    enabled,
    all: true,
  })
}

/**
 * True for an invoice that still owes money and is payable right now.
 * Native invoices are payable only while status='open' (once self-reported they
 * move to pending_confirmation and shouldn't be paid again); ClubDesk rows use
 * the open balance + not-cancelled rule.
 */
export function isOpenInvoice(inv: FinanceInvoice): boolean {
  if (inv.source === 'native') return (inv.status ?? '') === 'open'
  const status = (inv.status ?? '').toLowerCase()
  if (status.includes('storn') || status.includes('cancel')) return false
  return toNum(inv.open_amount) > 0
}

// ── Dues runs — recurring / batch membership-dues billing (migration 138) ──

/** A per-(fiscal_year, category[, sektion]) membership-fee rate. */
export interface DuesRate {
  id: number
  fiscal_year: number
  category: string
  sektion: string | null
  amount_chf: number | string
  subject_template: string | null
  active: boolean
}
export interface DuesRatesResponse {
  rates: DuesRate[]
  categories: string[]   // distinct beitragskategorie values from live active members
  sektionen: string[]
}
/** Rate schedule + the real category/sektion values for a fiscal year (finance/board). */
export function useDuesRates(fiscalYearId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'dues-rates', String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<DuesRatesResponse>(`/finance/dues-rates?fiscal_year=${fiscalYearId}`),
    enabled: enabled && fiscalYearId != null && fiscalYearId !== '',
  })
}

export interface SaveDuesRateInput {
  fiscal_year: number
  category: string
  sektion?: string | null
  amount_chf: number
  subject_template?: string | null
  active?: boolean
}
export const saveDuesRate = (input: SaveDuesRateInput) =>
  kscwApi<{ rate: DuesRate }>('/finance/dues-rates', { method: 'POST', body: input })
export const deleteDuesRate = (id: number) =>
  kscwApi<{ ok: true; removed: number }>(`/finance/dues-rates/${id}`, { method: 'DELETE' })

export interface DuesPreviewRow {
  member: number
  name: string | null
  email: string | null
  category: string | null
  sektion: string | null
  amount: number | null
  already_billed: boolean
  missing_rate: boolean
  missing_email: boolean
}
export interface DuesPreviewResult {
  fiscal_year: { id: number; label: string }
  rows: DuesPreviewRow[]
  totals: { members: number; billable: number; billable_amount: number; already_billed: number; missing_rate: number; no_email: number }
}
export interface DuesRunInput {
  fiscal_year: number
  categories: string[]
  sektion?: string | null
  only_active?: boolean
  due_date?: string | null
  label?: string
}
export const previewDuesRun = (input: DuesRunInput) =>
  kscwApi<DuesPreviewResult>('/finance/dues-runs/preview', { method: 'POST', body: input })

export interface DuesRunResult {
  run: { id: number; label: string; fiscal_year: number; total_count: number; total_amount: number }
  summary: { created: number; skipped_already_billed: number; skipped_no_rate: number }
  details: Array<{ member: number; invoice: string; amount: number }>
}
export const issueDuesRun = (input: DuesRunInput) =>
  kscwApi<DuesRunResult>('/finance/dues-runs/issue', { method: 'POST', body: input })

export interface DuesRun {
  id: number
  fiscal_year: number
  fiscal_year_label: string | null
  label: string | null
  status: string
  total_count: number
  total_amount: number | string
  created_by_name: string | null
  date_created: string | null
}
/** Past dues runs for a fiscal year (finance/board). */
export function useDuesRuns(fiscalYearId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'dues-runs', String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<{ runs: DuesRun[] }>(`/finance/dues-runs${fiscalYearId ? `?fiscal_year=${fiscalYearId}` : ''}`),
    enabled,
    select: (r) => r.runs,
  })
}
export const cancelDuesRun = (id: number) =>
  kscwApi<{ ok: true; cancelled: number }>(`/finance/dues-runs/${id}/cancel`, { method: 'POST' })

export interface DuesRunInvoice {
  id: number
  number: string | null
  recipient_name: string | null
  subject: string | null
  amount: number | string
  open_amount: number | string
  status: string
  reference: string | null
  reference_type: string | null
}
/** A dues run's non-cancelled invoices (finance/board) — for the bulk QR-bill PDF. */
export const fetchDuesRunInvoices = (id: number) =>
  kscwApi<{ run: { id: number; label: string | null }; invoices: DuesRunInvoice[] }>(`/finance/dues-runs/${id}/invoices`)
