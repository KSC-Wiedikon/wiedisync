import { useTranslation } from 'react-i18next'
import { CheckCircle2, AlertTriangle, Loader2, Activity, Database, Calendar } from 'lucide-react'
import { usePublicStatus } from '../../hooks/useBugfixes'
import { useInfraHealth } from '../../hooks/useInfraHealth'
import { formatDateCompact } from '../../utils/dateHelpers'
import { useReportPageLoading } from '../../hooks/usePageReady'

type ServiceStatus = 'ok' | 'warn' | 'down' | 'loading'

interface ServiceRow {
  key: string
  label: string
  icon: React.ReactNode
  status: ServiceStatus
  detail?: string
}

function relativeTime(iso: string | null, label: string): string {
  if (!iso) return label
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '< 1 min'
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h`
  const days = Math.floor(hrs / 24)
  return `${days} d`
}

function statusDot(status: ServiceStatus) {
  switch (status) {
    case 'ok': return <span className="h-2.5 w-2.5 rounded-full bg-green-500 shadow-sm shadow-green-500/40" />
    case 'warn': return <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/40" />
    case 'down': return <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/40" />
    default: return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-gray-400" />
  }
}

export default function StatusPage() {
  const { t } = useTranslation('bugfixes')
  const { data, isLoading: fixesLoading } = usePublicStatus()
  const { services, syncs, isLoading: healthLoading } = useInfraHealth()

  // Report to the app boot gate — see usePageReady.tsx. Gate on the primary
  // recent-fixes list only; the service-health rows fill in progressively and
  // would otherwise hang the overlay on the slowest probe.
  useReportPageLoading(fixesLoading)

  const apiService = services[0]
  const apiStatus: ServiceStatus = !apiService ? 'loading'
    : apiService.status === 'ok' ? 'ok'
    : apiService.status === 'loading' ? 'loading'
    : 'down'

  const sv = syncs.find(s => s.source === 'swiss_volley')
  const bp = syncs.find(s => s.source === 'basketplan')
  const gc = syncs.find(s => s.source === 'gcal')
  const syncRow = (s: typeof sv): ServiceStatus =>
    !s ? 'loading' : s.isStale ? 'warn' : 'ok'
  const syncDetail = (s: typeof sv): string | undefined => {
    if (!s) return undefined
    if (s.awaitingFirstRun) return t('statusAwaitingFirstRun')
    if (!s.lastUpdated) return undefined
    return `${relativeTime(s.lastUpdated, '')} ${t('statusAgo')}`
  }

  const rows: ServiceRow[] = [
    {
      key: 'api',
      label: t('statusApiLabel'),
      icon: <Activity className="h-4 w-4" />,
      status: apiStatus,
      detail: apiService?.latency != null ? `${apiService.latency} ms` : undefined,
    },
    {
      key: 'sv',
      label: t('statusSvLabel'),
      icon: <Database className="h-4 w-4" />,
      status: syncRow(sv),
      detail: syncDetail(sv),
    },
    {
      key: 'bp',
      label: t('statusBpLabel'),
      icon: <Database className="h-4 w-4" />,
      status: syncRow(bp),
      detail: syncDetail(bp),
    },
    {
      key: 'gc',
      label: t('statusGcalLabel'),
      icon: <Calendar className="h-4 w-4" />,
      status: syncRow(gc),
      detail: syncDetail(gc),
    },
  ]

  const anyDown = rows.some(r => r.status === 'down')
  const anyWarn = rows.some(r => r.status === 'warn')
  const anyLoading = rows.some(r => r.status === 'loading')
  const overall: ServiceStatus = anyDown ? 'down' : anyWarn ? 'warn' : anyLoading ? 'loading' : 'ok'

  const fixes = (data as { data?: { date: string; summary: string; status: string }[] })?.data ?? []
  const resolvedCount = fixes.filter(i => i.status === 'deployed_dev' || i.status === 'deployed_prod').length

  const bannerClass = overall === 'ok'
    ? 'border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20'
    : overall === 'warn'
      ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20'
      : overall === 'down'
        ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20'
        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
  const bannerIcon = overall === 'ok'
    ? <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
    : overall === 'loading'
      ? <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      : <AlertTriangle className={`h-8 w-8 ${overall === 'down' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
  const bannerTitle = overall === 'ok'
    ? t('statusAllOk')
    : overall === 'down'
      ? t('statusSomeDown')
      : overall === 'warn'
        ? t('statusSomeStale')
        : t('statusChecking')
  const bannerSubtitle = overall === 'ok'
    ? t('statusAllOkSubtitle')
    : t('statusDetailBelow')

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">{t('statusTitle')}</h1>
      </div>

      <div className={`flex items-center gap-4 rounded-lg border p-4 ${bannerClass}`}>
        {bannerIcon}
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{bannerTitle}</p>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{bannerSubtitle}</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50">
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map(row => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-3">
              <span className="text-gray-400 dark:text-gray-500">{row.icon}</span>
              <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">{row.label}</span>
              {row.detail && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{row.detail}</span>
              )}
              {statusDot(row.status)}
            </li>
          ))}
        </ul>
      </div>

      <div className="pt-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('recentFixes')}</h2>
      </div>

      {fixesLoading && (
        <div className="p-8 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {!fixesLoading && fixes.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/50">
          {t('noIssues')}
        </div>
      )}

      {fixes.length > 0 && (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('resolvedThisWeek', { count: resolvedCount })}
          </p>

          <div className="space-y-2">
            {fixes.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50"
              >
                <span className="mt-0.5 text-base">
                  {item.status === 'deployed_dev' || item.status === 'deployed_prod' ? '\u2705' : '\uD83D\uDD27'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 dark:text-gray-100">{item.summary}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">{formatDateCompact(item.date)}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {healthLoading && !anyDown && (
        <p className="text-center text-[10px] text-gray-400">{t('statusChecking')}</p>
      )}
    </div>
  )
}
