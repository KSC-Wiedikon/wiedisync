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
  ahv_nummer?: string | null
  beitragskategorie?: string | null
  kscw_membership_active?: boolean
  wiedisync_active?: boolean
  billing_different?: boolean
  billing_name?: string | null
  billing_email?: string | null
  billing_address?: string | null
  billing_plz?: string | null
  billing_ort?: string | null
  billing_phone?: string | null
}

const FINANCE_MEMBER_FIELDS = [
  'id', 'first_name', 'last_name', 'email', 'phone', 'number',
  'anrede', 'adresse', 'plz', 'ort', 'nationalitaet', 'sex', 'birthdate',
  'iban', 'ahv_nummer', 'beitragskategorie', 'kscw_membership_active', 'wiedisync_active',
  'billing_different', 'billing_name', 'billing_email', 'billing_address', 'billing_plz', 'billing_ort', 'billing_phone',
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
