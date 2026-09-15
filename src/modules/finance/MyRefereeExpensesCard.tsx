import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HandCoins } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useMyRefereeExpenses, formatChf, toNum } from '../../hooks/useFinance'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { currentSeasonShort, seasonForYmd } from '../../utils/season'
import type { RefereeExpenseLine } from './types'

const pillBase = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium'

/** The season a referee fee belongs to — the game's own label, else derived from its date. */
function refereeExpenseSeason(r: RefereeExpenseLine): string | null {
  if (r.game?.season) return r.game.season
  if (r.game?.date) return seasonForYmd(r.game.date)
  return null
}

/** Still owed by the club: a real amount that no (live) payout has settled yet. */
function isRefereeExpenseOutstanding(r: RefereeExpenseLine): boolean {
  return toNum(r.amount) > 0 && (r.payout == null || r.payout_status === 'cancelled')
}

/**
 * "Season end" (owed, no payout yet) / "Recorded" (CHF 0 — the club paid nothing
 * out of pocket) / "Reimbursed dd.mm.yyyy" (the season-end run has paid it) /
 * "Announced" (payout created, not yet paid).
 */
export function RefereeStatusPill({ row }: { row: RefereeExpenseLine }) {
  const { t } = useTranslation('finance')
  if (row.payout_status === 'paid') {
    const date = row.payout_date ? formatDateCompactZurich(row.payout_date) : ''
    return (
      <span className={`${pillBase} bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300`}>
        {t('refereeStatusReimbursed', { date }).trim()}
      </span>
    )
  }
  if (toNum(row.amount) === 0) {
    return <span className={`${pillBase} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300`}>{t('refereeStatusRecorded')}</span>
  }
  if (row.payout != null && row.payout_status === 'open') {
    return <span className={`${pillBase} bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300`}>{t('payoutStatusOpen')}</span>
  }
  return <span className={`${pillBase} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`}>{t('refereeStatusSeasonEnd')}</span>
}

/**
 * Member view of the referee fees they paid out of pocket at home games
 * (referee_expenses.paid_by_member = me). Read-only: the club reimburses them
 * in one season-end payout run, so the footer shows what is still owed for
 * the current season.
 */
export default function MyRefereeExpensesCard() {
  const { t } = useTranslation('finance')
  const { data } = useMyRefereeExpenses()
  const rows = useMemo(() => data ?? [], [data])
  const season = currentSeasonShort()

  const toReimburse = useMemo(
    () => rows
      .filter((r) => isRefereeExpenseOutstanding(r) && refereeExpenseSeason(r) === season)
      .reduce((acc, r) => acc + toNum(r.amount), 0),
    [rows, season],
  )

  if (rows.length === 0) return null

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <HandCoins className="h-4 w-4 text-brand-600 dark:text-brand-400" /> {t('myRefereeTitle')}
      </h2>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('myRefereeSubtitle')}</p>
      <div className="-mx-4 mt-3 border-t border-gray-200 dark:border-gray-700">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDate')}</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colGame')}</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colAmount')}</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="min-h-[44px] border-gray-200 dark:border-gray-700">
                <TableCell className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                  {r.game?.date ? formatDateCompactZurich(r.game.date) : (r.date_created ? formatDateCompactZurich(r.date_created) : '–')}
                </TableCell>
                <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                  {r.game ? `${r.game.home_team ?? '?'} – ${r.game.away_team ?? '?'}` : '–'}
                  {r.team_name && <span className="block text-xs text-gray-500 dark:text-gray-400">{r.team_name}</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(r.amount)}</TableCell>
                <TableCell><RefereeStatusPill row={r} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-gray-600 dark:text-gray-300">{t('myRefereeTotal')}</span>
        <span className={`font-semibold tabular-nums ${toReimburse > 0 ? 'text-brand-700 dark:text-brand-300' : 'text-gray-500 dark:text-gray-400'}`}>
          {formatChf(toReimburse)}
        </span>
      </div>
    </section>
  )
}
