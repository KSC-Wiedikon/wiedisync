import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { useMyInvoices, toNum, formatChf, isOpenInvoice } from '../../hooks/useFinance'

/**
 * Home-page card: the member's open dues. Renders nothing when there's no open
 * balance (mirrors FinesDashboardCard) so it never clutters a settled member's
 * dashboard. Links to /finance/dues.
 */
export default function YourDuesCard() {
  const { t } = useTranslation('finance')
  const { data: invoicesRaw } = useMyInvoices()
  const invoices = invoicesRaw ?? []

  const stats = useMemo(() => {
    const open = invoices.filter(isOpenInvoice)
    return { count: open.length, total: open.reduce((acc, i) => acc + toNum(i.open_amount), 0) }
  }, [invoices])

  if (stats.count === 0) return null

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <Link
        to="/finance/dues"
        className="block w-full rounded-xl border border-amber-200 bg-amber-50/60 p-4 transition-colors hover:border-amber-300 lg:max-w-2xl dark:border-amber-800/50 dark:bg-amber-900/20 dark:hover:border-amber-700"
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
      </Link>
    </div>
  )
}
