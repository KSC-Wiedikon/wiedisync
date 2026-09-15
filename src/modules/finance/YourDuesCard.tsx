import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Wallet, Users } from 'lucide-react'
import { useMyInvoices, useMyTeamInvoices, toNum, formatChf, isPayableInvoice } from '../../hooks/useFinance'

/**
 * Home-page card: the member's open PERSONAL dues (links to /finance/dues),
 * plus one line for open bills of a team they lead (links to /finance/team).
 * Renders nothing when neither is open (mirrors FinesDashboardCard) so it
 * never clutters a settled member's dashboard.
 */
export default function YourDuesCard() {
  const { t } = useTranslation('finance')
  const { data: invoicesRaw } = useMyInvoices()
  const { data: teamInvoicesRaw } = useMyTeamInvoices()
  const invoices = useMemo(() => invoicesRaw ?? [], [invoicesRaw])
  const teamInvoices = useMemo(() => teamInvoicesRaw ?? [], [teamInvoicesRaw])

  const stats = useMemo(() => {
    // Self-reported invoices are excluded — see isPayableInvoice.
    const open = invoices.filter(isPayableInvoice)
    return { count: open.length, total: open.reduce((acc, i) => acc + toNum(i.open_amount), 0) }
  }, [invoices])

  // Team bills are the Teamkasse's money, never the member's — a separate
  // line, never folded into the headline figure.
  const teamStats = useMemo(() => {
    const open = teamInvoices.filter(isPayableInvoice)
    return { count: open.length, total: open.reduce((acc, i) => acc + toNum(i.open_amount), 0) }
  }, [teamInvoices])

  if (stats.count === 0 && teamStats.count === 0) return null

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <div className="w-full overflow-hidden rounded-xl border border-amber-200 bg-amber-50/60 lg:max-w-2xl dark:border-amber-800/50 dark:bg-amber-900/20">
        {stats.count > 0 && (
          <Link
            to="/finance/dues"
            className="block p-4 transition-colors hover:bg-amber-100/60 dark:hover:bg-amber-900/30"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                <Wallet className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                {t('cardTitle')}
              </div>
              <span className="text-xs text-amber-700 dark:text-amber-400">{t('cardViewAll')} →</span>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <div className="text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-100">{formatChf(stats.total)}</div>
              <div className="text-xs text-amber-700/80 dark:text-amber-300/80">{t('cardOpenCount', { count: stats.count })}</div>
            </div>
            <div className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">{t('cardPayHint')}</div>
          </Link>
        )}
        {teamStats.count > 0 && (
          <Link
            to="/finance/team"
            className={`flex min-h-[44px] items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100/60 dark:text-amber-200 dark:hover:bg-amber-900/30 ${stats.count > 0 ? 'border-t border-amber-200/80 dark:border-amber-800/50' : ''}`}
          >
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              {t('cardTeamOpen', { amount: formatChf(teamStats.total) })}
            </span>
            <span className="text-amber-700 dark:text-amber-400">→</span>
          </Link>
        )}
      </div>
    </div>
  )
}
