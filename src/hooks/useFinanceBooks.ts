// Data layer of the parallel books (accounting.wiedisync.kscw.ch) — bank
// statements, rules, receipts, opening balance, the monthly ClubDesk comparison,
// archives and the switch checklist. Backend: kscw-endpoints/src/finance-books.js.
import { useQuery } from '@tanstack/react-query'
import { kscwApi, API_URL } from '../lib/api'

export type BankLineStatus = 'open' | 'posted' | 'ignored'

export interface BankLine {
  id: number
  booking_date: string
  value_date: string | null
  amount: string | number
  currency: string
  counterparty_name: string | null
  counterparty_iban: string | null
  reference: string | null
  remittance: string | null
  status: BankLineStatus
  proposed_account: number | null
  proposed_account_number: string | null
  proposed_account_name: string | null
  proposed_text: string | null
  proposed_by: string | null
  matched_invoice_number: string | null
  entry: number | null
  entry_voucher_no: string | null
  entry_debit: string | null
  entry_credit: string | null
  note: string | null
  posted_by_name: string | null
  posted_at: string | null
  fiscal_year: number | null
}

export interface StatementImportResult {
  statements: Array<{ id: string | null; iban: string | null; from: string | null; to: string | null; lines: number; balance: { ok: boolean | null; expected?: number; actual?: number } }>
  inserted: number
  skipped: number
  proposed: number
}

export interface BankRule {
  id: number
  name: string
  priority: number
  direction: 'in' | 'out' | 'any'
  match_iban: string | null
  match_name: string | null
  match_text: string | null
  account: number
  account_number?: string | null
  account_name?: string | null
  text_template: string | null
  active: boolean
}

export interface EntryDocument {
  id: number
  kind: 'receipt' | 'invoice' | 'statement' | 'contract' | 'other'
  note: string | null
  sha256: string
  uploaded_by_name: string | null
  date_created: string
  filename: string | null
  type: string | null
  filesize: number | null
}

export interface ReceiptCoverage {
  entries: number
  needing: number
  withReceipt: number
  missing: number
  missingIds: number[]
  counts: Record<string, number>
}

export interface OpeningLeg { account: number; side: 'debit' | 'credit'; amount: number; number?: string; name?: string }
export interface OpeningInfo {
  fiscal_year: { id: number; label: string; starts_on: string; ends_on: string; status: string }
  proposal: { legs: OpeningLeg[]; debit: number; credit: number; balanced: boolean }
  native_posted: boolean
  opening_account: number | null
  parallel_start_fy: number | null
  clearing_candidates: Array<{ id: number; number: string; name: string; type: string }>
}

export interface ParallelMonth {
  month: string
  through: string
  accountsCompared: number
  accountsDifferent: number
  differenceTotal: number
  signoff: { id: number; month: string; difference_total: string | number; accounts_different: number; note: string | null; signed_by_name: string | null; signed_at: string } | null
}
export interface ParallelRow { account: number; number: string; name: string; type: string | null; clubdesk: number; native: number; diff: number }
export interface ParallelResult {
  fiscal_year: { id: number; label: string; starts_on: string; ends_on: string; status: string }
  months: ParallelMonth[]
  month: string | null
  detail: { rows: ParallelRow[]; accountsCompared: number; accountsDifferent: number; differenceTotal: number } | null
  counts: { clubdesk: number; native: number }
}

export interface FinanceArchive {
  id: number
  fiscal_year: number
  fiscal_year_label: string | null
  sha256: string
  size_bytes: string | number
  contents: Record<string, unknown>
  offsite: Record<string, string> | null
  offsite_at: string | null
  created_by_name: string | null
  date_created: string
}

export type ReadinessStatus = 'pass' | 'fail' | 'pending'
export interface Readiness {
  ready: boolean
  checks: Array<{ key: string; status: ReadinessStatus; detail: Record<string, unknown> }>
  facts: Record<string, unknown>
}

const fyQ = (fy: string | number | null | undefined) => (fy ? `fiscal_year=${encodeURIComponent(String(fy))}` : '')

// ── Bank ─────────────────────────────────────────────────────────────────────
export function useBankLines(status: BankLineStatus | 'all', fiscalYearId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'bank-lines', status, String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<{ lines: BankLine[]; summary: Partial<Record<BankLineStatus, number>> }>(
      `/finance/bank/lines?${[status !== 'all' ? `status=${status}` : '', fyQ(fiscalYearId)].filter(Boolean).join('&')}`),
    enabled,
  })
}
export const importStatement = (xml: string) =>
  kscwApi<StatementImportResult>('/finance/bank/import', { method: 'POST', body: { xml } })
export const postBankLine = (id: number, input: { account?: number; text?: string } = {}) =>
  kscwApi<{ entry: { id: number; voucher_no: string } }>(`/finance/bank/lines/${id}/post`, { method: 'POST', body: input })
export const postProposedLines = (ids?: number[]) =>
  kscwApi<{ posted: number; failed: Array<{ id: number; error: string }> }>('/finance/bank/post-proposed', { method: 'POST', body: ids ? { ids } : {} })
export const ignoreBankLine = (id: number, note: string) =>
  kscwApi<{ ok: true }>(`/finance/bank/lines/${id}/ignore`, { method: 'POST', body: { note } })
export const reopenBankLine = (id: number) =>
  kscwApi<{ ok: true }>(`/finance/bank/lines/${id}/reopen`, { method: 'POST' })

export function useBankRules(enabled = true) {
  return useQuery({ queryKey: ['finance', 'bank-rules'], queryFn: () => kscwApi<{ rules: BankRule[] }>('/finance/bank/rules'), enabled, select: (r) => r.rules })
}
export const createBankRule = (rule: Partial<BankRule>) => kscwApi<{ rule: BankRule }>('/finance/bank/rules', { method: 'POST', body: rule })
export const updateBankRule = (id: number, rule: Partial<BankRule>) => kscwApi<{ rule: BankRule }>(`/finance/bank/rules/${id}`, { method: 'PATCH', body: rule })
export const deleteBankRule = (id: number) => kscwApi<{ ok: true }>(`/finance/bank/rules/${id}`, { method: 'DELETE' })

// ── Receipts ─────────────────────────────────────────────────────────────────
export function useEntryDocuments(entryId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'entry-documents', entryId],
    queryFn: () => kscwApi<{ documents: EntryDocument[] }>(`/finance/ledger/entries/${entryId}/documents`),
    enabled: enabled && entryId != null,
    select: (r) => r.documents,
  })
}
export function useReceiptCoverage(fiscalYearId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'receipt-coverage', String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<ReceiptCoverage>(`/finance/ledger/receipts?${fyQ(fiscalYearId)}`),
    enabled: enabled && !!fiscalYearId,
  })
}
export const documentFileUrl = (id: number) => `${API_URL}/kscw/finance/documents/${id}/file`
export const deleteDocument = (id: number) => kscwApi<{ ok: true }>(`/finance/documents/${id}`, { method: 'DELETE' })

/** Raw-body upload (the endpoint streams it — no multipart). */
export async function uploadEntryDocument(entryId: number, file: File, kind: EntryDocument['kind'] = 'receipt', note = '') {
  const qs = new URLSearchParams({ filename: file.name, kind, ...(note ? { note } : {}) })
  const res = await fetch(`${API_URL}/kscw/finance/ledger/entries/${entryId}/documents?${qs}`, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body?.error || `Upload failed (${res.status})`), { body })
  }
  return (await res.json()) as { document: EntryDocument }
}

// ── Opening balance ──────────────────────────────────────────────────────────
export function useOpening(fiscalYearId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'opening', String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<OpeningInfo>(`/finance/opening?${fyQ(fiscalYearId)}`),
    enabled: enabled && !!fiscalYearId,
  })
}
export const postOpening = (fiscalYearId: number, openingAccount: number) =>
  kscwApi<{ posted: number; total: number }>('/finance/opening', { method: 'POST', body: { fiscal_year: fiscalYearId, opening_account: openingAccount } })

// ── Parallel run ─────────────────────────────────────────────────────────────
export function useParallel(fiscalYearId: string | number | null | undefined, month: string | null, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'parallel', String(fiscalYearId ?? ''), month ?? ''],
    queryFn: () => kscwApi<ParallelResult>(`/finance/parallel?${[fyQ(fiscalYearId), month ? `month=${month}` : ''].filter(Boolean).join('&')}`),
    enabled: enabled && !!fiscalYearId,
  })
}
export const signOffMonth = (fiscalYearId: number, month: string, note: string) =>
  kscwApi<{ signoff: unknown }>('/finance/parallel/signoff', { method: 'POST', body: { fiscal_year: fiscalYearId, month, note } })

// ── Archive + annual accounts ────────────────────────────────────────────────
export function useArchives(fiscalYearId?: string | number | null, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'archives', String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<{ archives: FinanceArchive[] }>(`/finance/archives${fiscalYearId ? `?${fyQ(fiscalYearId)}` : ''}`),
    enabled,
    select: (r) => r.archives,
  })
}
export const createArchive = (fiscalYearId: number) =>
  kscwApi<{ archive: FinanceArchive; contents: Record<string, unknown> }>('/finance/archive', { method: 'POST', body: { fiscal_year: fiscalYearId } })
export const archiveFileUrl = (id: number) => `${API_URL}/kscw/finance/archives/${id}/file`
export const annualAccountsPdfUrl = (fiscalYearId: number | string, book: 'native' | 'clubdesk') =>
  `${API_URL}/kscw/finance/annual-accounts.pdf?fiscal_year=${encodeURIComponent(String(fiscalYearId))}&book=${book}`

// ── Switch readiness ─────────────────────────────────────────────────────────
export function useSwitchReadiness(enabled = true) {
  return useQuery({ queryKey: ['finance', 'switch-readiness'], queryFn: () => kscwApi<Readiness>('/finance/switch/readiness'), enabled })
}

/** Download an authenticated file (session cookie) under a given name. */
export async function downloadAuthenticated(url: string, filename: string) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}
