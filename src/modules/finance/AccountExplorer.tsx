import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { toNum, formatChf } from '../../hooks/useFinance'
import type { FinanceAccount, FinanceTransaction } from './types'

/** Top-level categories by leading account digit (standard Swiss Verein layout). */
const CATEGORY_ORDER = ['1', '2', '3', '4', '9'] as const

export default function AccountExplorer({ accounts, transactions }: {
  accounts: FinanceAccount[]; transactions: FinanceTransaction[]
}) {
  const { t } = useTranslation('finance')
  const [selected, setSelected] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const nameByNum = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of accounts) m.set(a.number, a.name)
    return m
  }, [accounts])

  // Signed balance per account (debit-normal for asset/expense, else credit-normal),
  // from all the selected year's bookings (incl. opening + closing) — the raw account balance.
  const balByNum = useMemo(() => {
    const raw = new Map<string, number>() // debit - credit
    for (const tx of transactions) {
      const amt = toNum(tx.amount_chf)
      if (tx.debit_account_number) raw.set(tx.debit_account_number, (raw.get(tx.debit_account_number) ?? 0) + amt)
      if (tx.credit_account_number) raw.set(tx.credit_account_number, (raw.get(tx.credit_account_number) ?? 0) - amt)
    }
    const signed = new Map<string, number>()
    for (const a of accounts) {
      const r = raw.get(a.number) ?? 0
      signed.set(a.number, (a.type === 'asset' || a.type === 'expense') ? r : -r)
    }
    return signed
  }, [accounts, transactions])

  const catLabel = (digit: string) =>
    digit === '1' ? t('assets') : digit === '2' ? t('liabilitiesEquity')
    : digit === '3' ? t('income') : digit === '4' ? t('expense') : t('catClosing')

  const grouped = useMemo(() => CATEGORY_ORDER.map((digit) => ({
    digit,
    label: catLabel(digit),
    accounts: accounts.filter((a) => a.number.startsWith(digit)).sort((x, y) => x.number.localeCompare(y.number)),
  })).filter((g) => g.accounts.length > 0), [accounts]) // eslint-disable-line react-hooks/exhaustive-deps

  const selAccount = accounts.find((a) => a.number === selected) ?? null
  const debitNormal = selAccount?.type === 'asset' || selAccount?.type === 'expense'

  const ledger = useMemo(() => {
    if (!selected) return []
    const rows = transactions
      .filter((tx) => tx.debit_account_number === selected || tx.credit_account_number === selected)
      .sort((a, b) => (a.booking_date || '').localeCompare(b.booking_date || ''))
    let run = 0
    return rows.map((tx) => {
      const amt = toNum(tx.amount_chf)
      const isDebit = tx.debit_account_number === selected
      const soll = isDebit ? amt : 0
      const haben = isDebit ? 0 : amt
      run += debitNormal ? soll - haben : haben - soll
      const gegen = isDebit ? tx.credit_account_number : tx.debit_account_number
      return { tx, soll, haben, gegen, saldo: run }
    })
  }, [selected, transactions, debitNormal])

  const toggle = (digit: string) =>
    setCollapsed((c) => { const n = new Set(c); if (n.has(digit)) n.delete(digit); else n.add(digit); return n })

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      {/* Tree */}
      <div className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
        {grouped.map((g) => (
          <div key={g.digit} className="mb-1">
            <button
              onClick={() => toggle(g.digit)}
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {collapsed.has(g.digit) ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
              <span className="tabular-nums text-gray-400">{g.digit}</span> {g.label}
            </button>
            {!collapsed.has(g.digit) && (
              <ul className="ml-2 border-l border-gray-200 dark:border-gray-700">
                {g.accounts.map((a) => (
                  <li key={a.number}>
                    <button
                      onClick={() => setSelected(a.number)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                        selected === a.number
                          ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="min-w-0 truncate"><span className="tabular-nums text-gray-400">{a.number}</span> {a.name}</span>
                      <span className="shrink-0 tabular-nums text-xs text-gray-500 dark:text-gray-400">{formatChf(balByNum.get(a.number) ?? 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Ledger detail */}
      <div className="min-w-0">
        {!selAccount ? (
          <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {t('selectAccount')}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                <span className="tabular-nums text-gray-400">{selAccount.number}</span> {selAccount.name}
              </h3>
              <span className="tabular-nums text-sm font-semibold text-gray-900 dark:text-gray-100">{formatChf(balByNum.get(selAccount.number) ?? 0)}</span>
            </div>
            {ledger.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('noBookings')}</div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                      <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDate')}</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colText')}</TableHead>
                      <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colGegenkonto')}</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDebit')}</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colCredit')}</TableHead>
                      <TableHead className="hidden sm:table-cell text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colSaldo')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.map((r) => (
                      <TableRow key={r.tx.id} className="border-gray-200 dark:border-gray-700">
                        <TableCell className="whitespace-nowrap text-gray-900 dark:text-gray-100">{r.tx.booking_date ? formatDateCompactZurich(r.tx.booking_date) : '–'}</TableCell>
                        <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                          {r.tx.text || '–'}
                          {r.tx.beleg && <span className="ml-1 text-xs text-gray-400">({r.tx.beleg})</span>}
                          <span className="mt-0.5 block text-xs text-gray-400 md:hidden">{r.gegen} {nameByNum.get(r.gegen ?? '') ?? ''}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell whitespace-normal break-words text-gray-600 dark:text-gray-400">
                          <span className="tabular-nums text-gray-400">{r.gegen || '–'}</span> {nameByNum.get(r.gegen ?? '') ?? ''}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{r.soll ? formatChf(r.soll) : ''}</TableCell>
                        <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{r.haben ? formatChf(r.haben) : ''}</TableCell>
                        <TableCell className="hidden sm:table-cell text-right tabular-nums text-gray-600 dark:text-gray-400">{formatChf(r.saldo)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
