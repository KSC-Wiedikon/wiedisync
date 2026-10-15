import { useMemo } from 'react'
import { useFinanceAccounts, useFinanceTransactions, toNum } from '../../../hooks/useFinance'
import type { AccountType, FinanceAccount, FinanceTransaction } from '../types'
import { YEAR_END_ENTRY_TYPES, type EntryType } from '@finance-values'

export type AcctRow = FinanceAccount & { bal: number }

/** Aggregate debit/credit totals per account number from a set of transactions. */
function statsFrom(rows: FinanceTransaction[]) {
  const map = new Map<string, { debit: number; credit: number }>()
  const bump = (num: string | null, key: 'debit' | 'credit', amt: number) => {
    if (!num) return
    const e = map.get(num) ?? { debit: 0, credit: 0 }
    e[key] += amt
    map.set(num, e)
  }
  for (const tx of rows) {
    const amt = toNum(tx.amount_chf)
    bump(tx.debit_account_number, 'debit', amt)
    bump(tx.credit_account_number, 'credit', amt)
  }
  return map
}

export interface MonthPoint { month: string; income: number; expense: number }

/** Year-end closing and opening entries move balances between years — they are not income or expense. */
const isYearEntry = (tx: FinanceTransaction) => YEAR_END_ENTRY_TYPES.includes(tx.entry_type as EntryType)

/**
 * What one booking does to the year's result: + for income (or an expense refunded),
 * − for an expense (or income paid back), 0 for a transfer between balance-sheet
 * accounts and for the closing/opening entries.
 */
export function resultEffect(tx: FinanceTransaction, typeByNum: Map<string, AccountType | null>): number {
  if (isYearEntry(tx)) return 0
  const amt = toNum(tx.amount_chf)
  const isPl = (num: string | null) => { const t = num ? typeByNum.get(num) : null; return t === 'income' || t === 'expense' }
  return (isPl(tx.credit_account_number) ? amt : 0) - (isPl(tx.debit_account_number) ? amt : 0)
}

/**
 * The club's book for one fiscal year, as the reports read it: the ClubDesk mirror
 * (source='clubdesk'), the book of record while the two books run in parallel. The
 * native book has its own pages (journal, trial balance, parallel run) — it is never
 * summed in here, or a year with both would count twice. Flip `source` when the
 * native book becomes the book of record.
 */
export function useClubBook(fyId: string) {
  const { data: accountsRaw } = useFinanceAccounts()
  const { data: txRaw } = useFinanceTransactions(fyId || null, !!fyId, 'clubdesk')
  const accounts = useMemo(() => accountsRaw ?? [], [accountsRaw])
  const transactions = useMemo(() => txRaw ?? [], [txRaw])
  // Raw data is `undefined` only while a query is in flight. Pages also wait for the
  // fiscal-year list (useAccountingFy().loading) — until it lands fyId is ''.
  const loading = accountsRaw === undefined || (!!fyId && txRaw === undefined)

  const nameByNum = useMemo(() => { const m = new Map<string, string>(); for (const a of accounts) m.set(a.number, a.name); return m }, [accounts])
  const typeByNum = useMemo(() => { const m = new Map<string, AccountType | null>(); for (const a of accounts) m.set(a.number, a.type); return m }, [accounts])
  // P&L excludes the year-end closing and opening entries: the closing zeroes the
  // income/expense accounts, so a CLOSED year would otherwise read as 0.
  const plTransactions = useMemo(() => transactions.filter((tx) => !isYearEntry(tx)), [transactions])
  const allStats = useMemo(() => statsFrom(transactions), [transactions])
  const plStats = useMemo(() => statsFrom(plTransactions), [plTransactions])

  /** Natural-sign balance: income/expense read the P&L stats, balance-sheet accounts all bookings. */
  const accountRows = useMemo<AcctRow[]>(() => accounts.map((a) => {
    const nominal = a.type === 'income' || a.type === 'expense'
    const s = (nominal ? plStats : allStats).get(a.number) ?? { debit: 0, credit: 0 }
    const bal = (a.type === 'asset' || a.type === 'expense') ? s.debit - s.credit : s.credit - s.debit
    return { ...a, bal }
  }), [accounts, allStats, plStats])

  const nonZero = (a: AcctRow) => Math.abs(a.bal) > 0.005
  const incomeRows = useMemo(() => accountRows.filter((a) => a.type === 'income' && nonZero(a)).sort((x, y) => y.bal - x.bal), [accountRows])
  const expenseRows = useMemo(() => accountRows.filter((a) => a.type === 'expense' && nonZero(a)).sort((x, y) => y.bal - x.bal), [accountRows])
  const assetRows = useMemo(() => accountRows.filter((a) => a.type === 'asset' && nonZero(a)).sort((x, y) => x.number.localeCompare(y.number)), [accountRows])
  const liabEqRows = useMemo(() => accountRows.filter((a) => (a.type === 'liability' || a.type === 'equity') && nonZero(a)).sort((x, y) => x.number.localeCompare(y.number)), [accountRows])

  const sum = (rows: AcctRow[]) => rows.reduce((s, a) => s + a.bal, 0)
  const totalIncome = sum(incomeRows)
  const totalExpense = sum(expenseRows)
  const totalAssets = sum(assetRows)
  const totalLiabEq = sum(liabEqRows)
  /** Liquid funds: the 10xx accounts (cash, post, bank). */
  const treasury = useMemo(() => accountRows.filter((a) => a.number.startsWith('10')).reduce((s, a) => s + a.bal, 0), [accountRows])

  const divisions = useMemo(() => (['vb', 'bb', 'club'] as const).map((d) => {
    const inc = incomeRows.filter((a) => a.division === d).reduce((s, a) => s + a.bal, 0)
    const exp = expenseRows.filter((a) => a.division === d).reduce((s, a) => s + a.bal, 0)
    return { d, inc, exp, net: inc - exp }
  }).filter((x) => Math.abs(x.inc) > 0.005 || Math.abs(x.exp) > 0.005), [incomeRows, expenseRows])

  /** Income and expenses per calendar month (YYYY-MM), oldest first. */
  const monthly = useMemo<MonthPoint[]>(() => {
    const m = new Map<string, MonthPoint>()
    for (const tx of plTransactions) {
      const month = (tx.booking_date || '').slice(0, 7)
      if (!month) continue
      const p = m.get(month) ?? { month, income: 0, expense: 0 }
      const amt = toNum(tx.amount_chf)
      const dt = tx.debit_account_number ? typeByNum.get(tx.debit_account_number) : null
      const ct = tx.credit_account_number ? typeByNum.get(tx.credit_account_number) : null
      if (ct === 'income') p.income += amt
      if (dt === 'income') p.income -= amt
      if (dt === 'expense') p.expense += amt
      if (ct === 'expense') p.expense -= amt
      m.set(month, p)
    }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month))
  }, [typeByNum, plTransactions])

  return {
    loading, accounts, transactions, plTransactions, nameByNum, typeByNum, accountRows,
    incomeRows, expenseRows, assetRows, liabEqRows,
    totalIncome, totalExpense, result: totalIncome - totalExpense, totalAssets, totalLiabEq,
    treasury, divisions, monthly,
  }
}
