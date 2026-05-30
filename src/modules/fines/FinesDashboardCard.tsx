import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Gavel } from 'lucide-react'
import { useFines, formatFineAmount } from '../../hooks/useFines'

interface FinesDashboardCardProps {
  teamId: string | number
}

/**
 * Compact "Fines this month" card for the coach dashboard. Shows team total
 * + count for the calendar month, with delta vs. last month. Links to the
 * /fines page pre-filtered to this team.
 */
export default function FinesDashboardCard({ teamId }: FinesDashboardCardProps) {
  const { t } = useTranslation('fines')

  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()

  const { data: finesRaw } = useFines({
    filter: {
      _and: [
        { team: { _eq: teamId } },
        { issued_at: { _gte: lastMonthStart } },
      ],
    },
    fields: ['id', 'amount', 'status', 'issued_at'],
  })
  const fines = finesRaw ?? []

  const stats = useMemo(() => {
    const thisMonth = fines.filter((f) => f.issued_at >= thisMonthStart)
    const lastMonth = fines.filter((f) => f.issued_at < thisMonthStart)
    const thisOpen = thisMonth.filter((f) => f.status === 'open')
    const thisTotal = thisMonth.reduce((acc, f) => acc + (Number(f.amount) || 0), 0)
    const lastTotal = lastMonth.reduce((acc, f) => acc + (Number(f.amount) || 0), 0)
    return {
      count: thisMonth.length,
      openCount: thisOpen.length,
      total: thisTotal,
      delta: thisTotal - lastTotal,
    }
  }, [fines, thisMonthStart])

  if (stats.count === 0) return null

  const deltaLabel =
    stats.delta > 0 ? t('dashboardCompareUp', { delta: formatFineAmount(stats.delta) })
    : stats.delta < 0 ? t('dashboardCompareDown', { delta: formatFineAmount(-stats.delta) })
    : t('dashboardCompareSame')

  return (
    <Link
      to={`/fines?team=${teamId}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-amber-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-amber-700"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <Gavel className="h-4 w-4 text-amber-600" />
          {t('dashboardTitle')}
        </div>
        <span className="text-xs text-amber-600 dark:text-amber-400">{t('dashboardViewAll')} →</span>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {formatFineAmount(stats.total)}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t('dashboardCount', { count: stats.count })}
          {stats.openCount > 0 && ` · ${stats.openCount} ${t('statusOpen').toLowerCase()}`}
        </div>
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{deltaLabel}</div>
    </Link>
  )
}
