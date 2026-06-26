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
  recipient_type: 'member' | 'team' | 'contact'
  member?: number
  team?: number
  contact?: number
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
export function useFinanceTransactions(fiscalYearId?: string | null, enabled = true, source?: string) {
  const filter: Record<string, unknown> = {}
  if (fiscalYearId) filter.fiscal_year = { _eq: fiscalYearId }
  if (source) filter.source = { _eq: source }
  return useCollection<FinanceTransaction>('finance_transactions', {
    filter: Object.keys(filter).length ? filter : undefined,
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

// ── Dues-run email send + the global TEST MODE switch (migration 140) ──

export interface FinanceEmailSettings {
  test_mode: boolean
  test_recipient: string | null
}
/** The finance email test-mode switch (finance/board). */
export function useFinanceEmailSettings(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'email-settings'],
    queryFn: () => kscwApi<FinanceEmailSettings>('/finance/email-settings'),
    enabled,
  })
}
export const saveFinanceEmailSettings = (input: FinanceEmailSettings) =>
  kscwApi<FinanceEmailSettings>('/finance/email-settings', { method: 'PATCH', body: input })

export interface DuesEmailPreview {
  mode: 'dry_run'
  test_mode: boolean
  test_recipient: string | null
  would_send: number
  no_email: number
  total: number
  recipients: Array<{ invoice: string | null; name: string | null; email: string | null }>
}
export interface DuesEmailJobStart {
  job_id: number
  total: number
  test_mode: boolean
  mode: 'test' | 'live'
}
export interface DuesEmailJob {
  id: number
  status: 'running' | 'done' | 'failed'
  test_mode: boolean
  total: number
  sent: number
  failed: number
  error: string | null
  date_created: string | null
}
/** Dry-run preview — who WOULD be emailed (no send). */
export const previewDuesEmails = (id: number) =>
  kscwApi<DuesEmailPreview>(`/finance/dues-runs/${id}/send-emails`, { method: 'POST', body: { dry_run: true } })
/** Kick off the send (runs in the background; poll fetchDuesEmailJob for progress).
 *  Test mode redirects all to the test recipient; live emails members. */
export const sendDuesEmails = (id: number) =>
  kscwApi<DuesEmailJobStart>(`/finance/dues-runs/${id}/send-emails`, { method: 'POST', body: { dry_run: false, confirm: true } })
/** Latest send job for a run (progress polling). */
export const fetchDuesEmailJob = (id: number) =>
  kscwApi<{ job: DuesEmailJob | null }>(`/finance/dues-runs/${id}/email-job`)

// ── Settlement ledger — partial payments, cash, credit notes, refunds, write-offs (migration 143) ──

export type PaymentEntryType = 'payment' | 'credit_note' | 'refund' | 'writeoff'
export interface InvoicePayment {
  id: number
  payment_date: string | null
  amount: number | string
  entry_type: PaymentEntryType
  method: string | null
  note: string | null
  created_by_name: string | null
  camt_reference: string | null
  source: string
}
/** The settlement ledger for one invoice (finance/board). */
export function useInvoicePayments(invoiceId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'invoice-payments', String(invoiceId ?? '')],
    queryFn: () => kscwApi<{ payments: InvoicePayment[] }>(`/finance/invoices/${invoiceId}/payments`),
    enabled: enabled && invoiceId != null && invoiceId !== '',
    select: (r) => r.payments,
  })
}
export interface RecordPaymentInput {
  amount: number
  entry_type: PaymentEntryType
  method?: string | null
  payment_date?: string | null
  note?: string | null
}
export const recordInvoicePayment = (id: string | number, input: RecordPaymentInput) =>
  kscwApi<{ invoice: FinanceInvoice; payment_id: number }>(`/finance/invoices/${id}/payments`, { method: 'POST', body: input })
export const deleteInvoicePayment = (id: string | number, paymentId: number) =>
  kscwApi<{ invoice: FinanceInvoice }>(`/finance/invoices/${id}/payments/${paymentId}`, { method: 'DELETE' })

// ── Per-team finance — sponsoring income + team bills (migration 145) ──

export interface TeamSummaryRow {
  team: number
  team_name: string
  income: number
  expense: number
  net: number
  invoice_total: number
  invoice_open: number
}
/** Per-team income/expense/net + open bills for a fiscal year (finance/board). */
export function useTeamsSummary(fiscalYearId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'teams-summary', String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<{ teams: TeamSummaryRow[] }>(`/finance/teams-summary${fiscalYearId ? `?fiscal_year=${fiscalYearId}` : ''}`),
    enabled,
    select: (r) => r.teams,
  })
}

export type TeamEntryKind = 'sponsoring' | 'income' | 'expense'
export interface TeamEntry {
  id: number
  team: number
  fiscal_year: number | null
  kind: TeamEntryKind
  amount: number | string
  label: string | null
  sponsor: string | null
  entry_date: string | null
  note: string | null
  created_by_name: string | null
}
/** A team's finance entries (finance/board). */
export function useTeamEntries(teamId: string | number | null | undefined, fiscalYearId: string | number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'team-entries', String(teamId ?? ''), String(fiscalYearId ?? '')],
    queryFn: () => kscwApi<{ entries: TeamEntry[] }>(`/finance/team-entries?team=${teamId}${fiscalYearId ? `&fiscal_year=${fiscalYearId}` : ''}`),
    enabled: enabled && teamId != null && teamId !== '',
    select: (r) => r.entries,
  })
}
export interface TeamEntryInput {
  team: number
  fiscal_year?: number | null
  kind: TeamEntryKind
  amount: number
  label?: string | null
  sponsor?: string | null
  entry_date?: string | null
  note?: string | null
}
export const recordTeamEntry = (input: TeamEntryInput) =>
  kscwApi<{ id: number }>('/finance/team-entries', { method: 'POST', body: input })
export const deleteTeamEntry = (id: number) =>
  kscwApi<{ ok: true; removed: number }>(`/finance/team-entries/${id}`, { method: 'DELETE' })

// ── Budget vs actual — fills the dormant finance_budget_lines (migration 114) ──

export interface FinanceBudgetLine {
  id: string | number
  fiscal_year: string | number
  account: string | number
  amount_budgeted: number | string
  notes: string | null
}
/** Budget lines for a fiscal year (board/finance — items API, already granted). */
export function useFinanceBudget(fiscalYearId: string | number | null | undefined, enabled = true) {
  return useCollection<FinanceBudgetLine>('finance_budget_lines', {
    filter: fiscalYearId ? { fiscal_year: { _eq: fiscalYearId } } : undefined,
    enabled: enabled && !!fiscalYearId,
    all: true,
  })
}
export const saveBudgetLine = (input: { fiscal_year: number; account: number; amount_budgeted: number; notes?: string | null }) =>
  kscwApi<{ budget: FinanceBudgetLine }>('/finance/budget', { method: 'POST', body: input })
export const deleteBudgetLine = (id: number) =>
  kscwApi<{ ok: true }>(`/finance/budget/${id}`, { method: 'DELETE' })

// ── Dunning / Mahnwesen — reminders on overdue native invoices (migration 146) ──

export interface DunningCandidate {
  id: number
  number: string | null
  recipient_name: string | null
  recipient_email: string | null
  amount: number | string
  open_amount: number | string
  due_date: string | null
  dunning_level: number
  member: number | null
  never_dun: boolean | null
}
/** Overdue native invoices for the dunning console (finance/board). */
export function useDunningCandidates(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'dunning-candidates'],
    queryFn: () => kscwApi<{ candidates: DunningCandidate[]; today: string }>('/finance/dunning/candidates'),
    enabled,
  })
}
export interface EscalateInput { level: number; reminder_fee?: number; send_email?: boolean; force?: boolean }
export const escalateDunning = (id: number, input: EscalateInput) =>
  kscwApi<{ ok: true; level: number; channel: string; send_result: string }>(`/finance/dunning/${id}/escalate`, { method: 'POST', body: input })
export const setMemberNeverDun = (memberId: number, value: boolean) =>
  kscwApi<{ ok: true; never_dun: boolean }>(`/finance/members/${memberId}/never-dun`, { method: 'POST', body: { value } })

// ── Billing contacts — invoice non-members (sponsors/parents/companies, mig 147) ──

export interface BillingContact {
  id: number
  kind: string
  name: string
  email: string | null
  address: string | null
  plz: string | null
  ort: string | null
  billing_iban: string | null
  notes: string | null
}
/** Active billing contacts (finance/board). */
export function useBillingContacts(enabled = true) {
  return useQuery({
    queryKey: ['finance', 'contacts'],
    queryFn: () => kscwApi<{ contacts: BillingContact[] }>('/finance/contacts'),
    enabled,
    select: (r) => r.contacts,
  })
}
export const createBillingContact = (input: { kind: string; name: string; email?: string | null; billing_iban?: string | null; notes?: string | null }) =>
  kscwApi<{ contact: BillingContact }>('/finance/contacts', { method: 'POST', body: input })
export const deleteBillingContact = (id: number) =>
  kscwApi<{ ok: true }>(`/finance/contacts/${id}`, { method: 'DELETE' })

// ── Native ledger (book of record) ──────────────────────────────────────
export interface LedgerAccount { id: number; number: string; name: string; type: string | null; division: string | null; active: boolean; source: string }
export interface LedgerEntry { id: number; beleg: string | null; booking_date: string | null; text: string | null; debit_account: number | null; debit_account_number: string | null; debit_account_name: string | null; credit_account: number | null; credit_account_number: string | null; credit_account_name: string | null; amount_chf: string | number; typ: string | null; reversal_of: number | null; created_by_name: string | null }
export interface TrialBalanceRow { account: number; number: string; name: string; type: string | null; division: string | null; nominal: boolean; debit: number; credit: number; balance: number }
export interface LedgerFiscalYear { id: number; label: string | null; starts_on: string; ends_on: string; status: string; closed_on: string | null; closed_by_name: string | null }
export interface LedgerSettings { id: number; autopost_enabled: boolean; debitoren_account: number | null; bank_account: number | null; income_account: number | null; sponsoring_account: number | null; bad_debt_account: number | null; expense_account: number | null; prepayment_account: number | null }
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense', 'close'] as const

export function useLedgerAccounts(enabled = true, all = false) {
  return useQuery({ queryKey: ['finance', 'ledger-accounts', all], queryFn: () => kscwApi<{ accounts: LedgerAccount[] }>(`/finance/ledger/accounts${all ? '?active=all' : ''}`), enabled, select: (r) => r.accounts })
}
export function useLedgerEntries(fiscalYearId?: string | number | null, enabled = true) {
  return useQuery({ queryKey: ['finance', 'ledger-entries', String(fiscalYearId ?? '')], queryFn: () => kscwApi<{ entries: LedgerEntry[] }>(`/finance/ledger/entries${fiscalYearId ? `?fiscal_year=${fiscalYearId}` : ''}`), enabled, select: (r) => r.entries })
}
export function useLedgerTrialBalance(fiscalYearId?: string | number | null, enabled = true) {
  return useQuery({ queryKey: ['finance', 'ledger-trial', String(fiscalYearId ?? '')], queryFn: () => kscwApi<{ rows: TrialBalanceRow[]; totals: { debit: number; credit: number; balanced: boolean } }>(`/finance/ledger/trial-balance${fiscalYearId ? `?fiscal_year=${fiscalYearId}` : ''}`), enabled })
}
export function useLedgerFiscalYears(enabled = true) {
  return useQuery({ queryKey: ['finance', 'ledger-fy'], queryFn: () => kscwApi<{ fiscal_years: LedgerFiscalYear[] }>('/finance/ledger/fiscal-years'), enabled, select: (r) => r.fiscal_years })
}
export function useLedgerSettings(enabled = true) {
  return useQuery({ queryKey: ['finance', 'ledger-settings'], queryFn: () => kscwApi<{ settings: LedgerSettings }>('/finance/ledger/settings'), enabled, select: (r) => r.settings })
}

export const createLedgerAccount = (input: { number: string; name: string; type: string; division?: string | null }) => kscwApi<{ account: LedgerAccount }>('/finance/ledger/accounts', { method: 'POST', body: input })
export const editLedgerAccount = (id: number, input: { name?: string; active?: boolean }) => kscwApi<{ account: LedgerAccount }>(`/finance/ledger/accounts/${id}`, { method: 'PATCH', body: input })
export const postLedgerEntry = (input: { debit_account: number; credit_account: number; amount: number; text?: string; booking_date?: string; fiscal_year?: number }) => kscwApi<{ entry: LedgerEntry }>('/finance/ledger/entries', { method: 'POST', body: input })
export const reverseLedgerEntry = (id: number) => kscwApi<{ entry: LedgerEntry }>(`/finance/ledger/entries/${id}/reverse`, { method: 'POST' })
export const deleteLedgerEntry = (id: number) => kscwApi<{ ok: true }>(`/finance/ledger/entries/${id}`, { method: 'DELETE' })
export const closeLedgerYear = (fiscalYearId: number, input: { equity_account: number; opening_account: number; dry_run?: boolean }) => kscwApi<{ income: number; expense: number; net: number; closing_entries: number; opening_entries: number; next_fiscal_year: number; dry_run?: boolean }>(`/finance/ledger/fiscal-years/${fiscalYearId}/close`, { method: 'POST', body: input })
export const saveLedgerSettings = (input: Partial<LedgerSettings>) => kscwApi<{ settings: LedgerSettings }>('/finance/ledger/settings', { method: 'PATCH', body: input })
export const reconcileLedger = (fiscalYear?: number | null) => kscwApi<{ invoices: number; team_entries: number; posted: number; skipped: Record<string, number> }>('/finance/ledger/reconcile', { method: 'POST', body: { fiscal_year: fiscalYear ?? null } })
export const seedLedgerChart = () => kscwApi<{ added: number; skipped_existing: number }>('/finance/ledger/seed-chart', { method: 'POST' })
