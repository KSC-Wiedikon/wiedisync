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
