// Finance data hooks (migration 114). Read-only mirror of ClubDesk Finanz.
// Members read only their OWN invoices (policy-enforced); Vorstand reads all.

import { useCollection } from '../lib/query'
import { useAuth } from './useAuth'
import type {
  FinanceInvoice, FinanceTransaction, FinanceAccount, FinanceFiscalYear,
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

/** The current member's own invoices/dues. Empty for guests. */
export function useMyInvoices() {
  const { user } = useAuth()
  return useCollection<FinanceInvoice>('finance_invoices', {
    filter: user ? { member: { _eq: user.id } } : { id: { _eq: -1 } },
    sort: ['-invoice_date'],
    enabled: !!user,
    all: true,
  })
}

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

/** True for an invoice that still owes money (open balance > 0, not cancelled). */
export function isOpenInvoice(inv: FinanceInvoice): boolean {
  const status = (inv.status ?? '').toLowerCase()
  if (status.includes('storn') || status.includes('cancel')) return false
  return toNum(inv.open_amount) > 0
}
