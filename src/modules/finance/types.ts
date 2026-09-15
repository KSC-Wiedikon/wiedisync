// Finance module types — mirror of the ClubDesk Finanz data (migration 114).
// Money columns are Postgres numeric → Directus returns them as strings, so the
// money fields are typed `number | string | null` and coerced via toNum().

export type Money = number | string | null

export interface FinanceInvoice {
  id: string
  clubdesk_id: string
  number: string | null
  invoice_date: string | null
  subject: string | null
  amount: Money
  status: string | null
  dunning_status: string | null
  due_date: string | null
  amount_paid: Money
  open_amount: Money
  overpaid_amount: Money
  written_off_amount: Money
  payment_method: string | null
  reference: string | null
  fee_category: string | null
  closed_on: string | null
  recipient_name?: string | null
  recipient_email?: string | null
  member?: string | null
  fiscal_year?: string | null
  // Native-invoice fields (migrations 128/129). source distinguishes a native
  // (created-in-wiedisync) invoice from a ClubDesk mirror row.
  source?: 'clubdesk' | 'native' | string | null
  reference_type?: 'NON' | 'SCOR' | 'QRR' | string | null
  team?: string | null
  team_name?: string | null
  reported_paid_at?: string | null
  reported_paid_method?: string | null
  reported_paid_by?: string | null
  confirmed_at?: string | null
  confirmed_via?: 'sync' | 'manual' | string | null
  cancelled_at?: string | null
  /** Positions of a native invoice (jsonb), in the club's invoice language.
   *  They answer "why this amount?" — and on a CHF 0 invoice they are the ONLY
   *  thing that does: the total alone cannot tell a free membership from a
   *  billing mistake. ClubDesk mirror rows carry none. */
  lines?: Array<{ label: string; amount: number }> | null
  /** Author of a native invoice. ClubDesk's export carries no author field. */
  created_by_name?: string | null
  created_by_email?: string | null
  /** Row insert time — for a ClubDesk mirror row this is the last nightly sync, NOT the invoice's creation. */
  date_created?: string | null
  /** ClubDesk's own creation timestamp (mirror rows only). */
  cd_created_at?: string | null
}

/** Native-invoice lifecycle (rides the shared `status` column when source='native'). */
export type NativeStatus = 'open' | 'pending_confirmation' | 'paid' | 'cancelled'

export interface FinanceTransaction {
  id: string
  clubdesk_id: string | null
  typ: string | null
  beleg: string | null
  booking_date: string
  text: string | null
  debit_account_number: string | null
  debit_account_name: string | null
  credit_account_number: string | null
  credit_account_name: string | null
  amount_chf: Money
  fiscal_year?: string | null
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'close'

export interface FinanceAccount {
  id: string
  number: string
  name: string
  type: AccountType | null
  division: 'club' | 'vb' | 'bb' | null
  active: boolean
}

export interface FinanceFiscalYear {
  id: string
  label: string
  starts_on: string
  ends_on: string
  status: string
}

export interface FinanceImport {
  id: string
  import_type: string
  filename: string | null
  imported_at: string
  imported_by_name: string | null
  imported_by_email: string | null
  row_count: number | null
  fiscal_year_label: string | null
}

// ── Referee fees + Team finance (read-time views over referee_expenses) ──
// referee_expenses is the single record (written in GameDetailModal); these
// shapes are what /finance/my-invoices and /finance/team/:id derive from it.
// Nothing is mirrored into finance_expenses / finance_team_entries.

/** One referee fee, as served to the paying member and to the team page. */
export interface RefereeExpenseLine {
  id: number
  amount: Money
  currency: string | null
  notes: string | null
  date_created: string | null
  paid_by_member: number | null
  /** Display name of the payer — member name, else `paid_by_other`. */
  paid_by: string | null
  team: number | null
  team_name: string | null
  game: {
    id: number
    date: string | null
    time: string | null
    home_team: string | null
    away_team: string | null
    league: string | null
    season: string | null
  } | null
  /** finance_payouts FK once the season-end run has settled the row (migration 363). */
  payout: number | null
  payout_status: 'open' | 'paid' | 'cancelled' | null
  payout_date: string | null
}

/** Totals block of /finance/team/:id. `referee_total` is club-reimbursed and
 *  deliberately NOT part of `net` — the Teamkasse never carries referee fees. */
export interface TeamFinanceTotals {
  income: number
  expense: number
  net: number
  invoice_total: number
  invoice_open: number
  referee_total: number
  team_fines_open: number
}

/** A team's finance entry (finance_team_entries) — same shape as the treasurer's tab. */
export interface TeamFinanceEntry {
  id: number
  team: number
  fiscal_year: number | null
  kind: 'sponsoring' | 'income' | 'expense'
  amount: Money
  label: string | null
  sponsor: string | null
  entry_date: string | null
  note: string | null
  created_by_name: string | null
}

/** GET /kscw/finance/team/:teamId?season=YYYY/YY */
export interface TeamFinanceResponse {
  team: { id: number; name: string; sport: string | null }
  /** Short season label, e.g. "2026/27" (== finance_fiscal_years.label). */
  season: string
  fiscal_year: { id: number; label: string; status: string } | null
  entries: TeamFinanceEntry[]
  invoices: FinanceInvoice[]
  referee_expenses: RefereeExpenseLine[]
  totals: TeamFinanceTotals
  /** Caller may use the pay / "I've paid" flow on the team bills (lead or finance). */
  can_pay: boolean
}

/** One planned / created payout of the season-end referee reimbursement run. */
export interface RefereePayoutPlanRow {
  member: number
  member_name: string
  games: number
  total: number
  iban: string | null
  /** Skip reason code (NO_IBAN, ADDRESS_INCOMPLETE, NON_CHF, …) — null when payable. */
  skip: string | null
  expense_ids: number[]
  /** Set on a real (non-dry) run. */
  payout_id?: number | null
}

/** POST /kscw/finance/referee-payout-run */
export interface RefereePayoutRunResponse {
  season: string
  dry_run: boolean
  rows: RefereePayoutPlanRow[]
  created: number
  skipped: number
  total: number
}
