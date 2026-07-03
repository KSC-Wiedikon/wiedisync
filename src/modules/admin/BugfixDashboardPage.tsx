import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  RefreshCcw, ChevronDown, ChevronRight, Bug,
  ExternalLink, Check, Loader2, XCircle, RotateCcw,
} from 'lucide-react'
import {
  useBugfixIssues,
  useBugfixStatus,
  useTriggerFix,
  useDeployFix,
  useDismissFix,
  useReopenFix,
  type BugfixIssue,
} from '../../hooks/useBugfixes'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog'
import { formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import { sanitizeUrl } from '../../utils/sanitizeUrl'
import { Table, TableBody, TableCell, TableRow } from '../../components/ui/table'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useReportPageLoading } from '../../hooks/usePageReady'

// ── Helpers ──────────────────────────────────────────────────────────

function makeRTF(lang: string) {
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
}

function relativeTime(iso: string, lang = 'en'): string {
  const rtf = makeRTF(lang)
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return rtf.format(-seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  return rtf.format(-days, 'day')
}

function absoluteTime(iso: string): string {
  return formatDateTimeCompactZurich(iso)
}

function parseUserAgent(ua: string): string {
  if (!ua) return '—'
  const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/)?.[0]
    ?? ua.match(/(MSIE|Trident)[\s/][\d.]+/)?.[0]
    ?? 'Unknown browser'
  const os = ua.match(/(Windows NT [\d.]+|Mac OS X [\d._]+|Linux|Android [\d.]+|iOS [\d._]+)/)?.[0]
    ?? 'Unknown OS'
  return `${browser} / ${os}`
}

function parseFileLine(stack: string): string | null {
  if (!stack) return null
  const m = stack.match(/at\s+.*?[(/]([\w./:-]+:\d+:\d+)/)
  return m?.[1] ?? null
}

// ── Status badge ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  fixing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse',
  pr_ready: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  deployed_dev: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  deployed_prod: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  reverted: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  dismissed: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const labels: Record<string, string> = {
    new: t('statusNew'),
    fixing: t('statusFixing'),
    pr_ready: t('statusPrReady'),
    deployed_dev: t('statusDeployedDev'),
    deployed_prod: t('statusDeployedProd'),
    failed: t('statusFailed'),
    reverted: t('statusReverted'),
    dismissed: t('statusDismissed'),
  }
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[status] ?? STATUS_COLORS.new}`}>
      {labels[status] ?? status}
    </span>
  )
}

// ── Polling component for fixing rows ────────────────────────────────

function FixingStatusPoller({ hash, startedAt }: { hash: string; startedAt: string }) {
  const qc = useQueryClient()
  const { data } = useBugfixStatus(hash, startedAt)
  const status = (data as { status?: string })?.status
  const [elapsed, setElapsed] = useState(() => Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  // When status changes from 'fixing', invalidate the issues list
  useEffect(() => {
    if (status && status !== 'fixing') {
      qc.invalidateQueries({ queryKey: ['bugfixes', 'issues'] })
    }
  }, [status, qc])
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return (
    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
      {mins}:{secs.toString().padStart(2, '0')}
    </span>
  )
}

// ── Issue row ────────────────────────────────────────────────────────

function IssueRow({ issue, t, lang }: { issue: BugfixIssue; t: (k: string, opts?: Record<string, unknown>) => string; lang: string }) {
  const [expanded, setExpanded] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const triggerFix = useTriggerFix()
  const deployFix = useDeployFix()
  const dismissFix = useDismissFix()
  const reopenFix = useReopenFix()

  const status = issue.annotation?.status === 'solved'
    ? 'dismissed'
    : issue.fix_status ?? 'new'

  function handleFix() {
    setConfirmAction({
      message: t('confirmFix'),
      onConfirm: () => triggerFix.mutate(issue.hash, { onError: (err) => toast.error(String(err)) }),
    })
  }
  function handleDeployDev() {
    setConfirmAction({
      message: t('confirmDeployDev'),
      onConfirm: () => deployFix.mutate({ hash: issue.hash, target: 'dev' }, { onError: (err) => toast.error(String(err)) }),
    })
  }
  function handleDeployProd() {
    setConfirmAction({
      message: t('confirmDeployProd'),
      onConfirm: () => deployFix.mutate({ hash: issue.hash, target: 'prod' }, { onError: (err) => toast.error(String(err)) }),
    })
  }
  function handleDismiss() {
    setConfirmAction({
      message: t('confirmDismiss'),
      onConfirm: () => dismissFix.mutate(issue.hash, { onError: (err) => toast.error(String(err)) }),
    })
  }
  function handleReopen() {
    setConfirmAction({
      message: t('confirmReopen'),
      onConfirm: () => reopenFix.mutate(issue.hash, { onError: (err) => toast.error(String(err)) }),
    })
  }

  const fileLine = parseFileLine(issue.expanded?.stack ?? '')

  return (
    <>
      {/* Collapsed scannable row */}
      <TableRow
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="cursor-pointer border-b-0 text-xs"
      >
        <TableCell className="w-6 pr-0">
          {expanded
            ? <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" />
          }
        </TableCell>
        <TableCell><StatusBadge status={status} t={t} /></TableCell>
        <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100" title={issue.message}>
          {issue.message.length > 80 ? issue.message.slice(0, 80) + '...' : issue.message}
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
            issue.source === 'frontend'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              : 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
          }`}>
            {issue.source === 'frontend' ? 'FE' : 'BE'}
          </span>
        </TableCell>
        <TableCell className="hidden sm:table-cell text-gray-400 font-mono">{issue.count}x</TableCell>
        <TableCell className="hidden sm:table-cell text-gray-400" title={absoluteTime(issue.first_seen)}>
          {relativeTime(issue.first_seen, lang)}
        </TableCell>
        <TableCell className="text-right text-gray-400" title={absoluteTime(issue.last_seen)}>
          {relativeTime(issue.last_seen, lang)}
        </TableCell>
      </TableRow>

      {/* Action buttons row */}
      <TableRow className={`hover:bg-transparent ${expanded ? 'border-b-0' : ''}`}>
        <TableCell colSpan={7} className="pt-0">
          <div className="flex items-center gap-1.5">

        {status === 'new' && (
          <>
            <button onClick={handleFix} className="rounded bg-brand-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-brand-700">
              {t('fix')}
            </button>
            <button onClick={handleDismiss} className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
              {t('dismiss')}
            </button>
          </>
        )}

        {status === 'fixing' && (
          <span className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('claudeWorking')}
            <FixingStatusPoller hash={issue.hash} startedAt={issue.fix_started_at ?? issue.first_seen} />
          </span>
        )}

        {status === 'pr_ready' && (
          <>
            {(() => {
              const safe = sanitizeUrl(issue.pr_url || '')
              return safe ? (
                <a href={safe} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700">
                  <ExternalLink className="h-2.5 w-2.5" /> {t('viewPr')}
                </a>
              ) : null
            })()}
            <button onClick={handleDeployDev} className="rounded bg-cyan-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-cyan-700">
              {t('deployDev')}
            </button>
            <button onClick={handleDismiss} className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
              {t('dismiss')}
            </button>
          </>
        )}

        {status === 'deployed_dev' && (
          <>
            <button onClick={handleDeployProd} className="rounded bg-green-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-green-700">
              {t('deployProd')}
            </button>
            <button onClick={handleDismiss} className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
              {t('revert')}
            </button>
          </>
        )}

        {status === 'deployed_prod' && (
          <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" /> {t('deployed')}
          </span>
        )}

        {status === 'failed' && (
          <>
            <span className="flex items-center gap-1 text-[10px] text-red-500">
              <XCircle className="h-3 w-3" /> {t('statusFailed')}
            </span>
            <button onClick={handleFix} className="flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-brand-700">
              <RotateCcw className="h-2.5 w-2.5" /> {t('retry')}
            </button>
            <button onClick={handleDismiss} className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
              {t('dismiss')}
            </button>
          </>
        )}

        {status === 'reverted' && (
          <>
            <button onClick={handleFix} className="flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-brand-700">
              <RotateCcw className="h-2.5 w-2.5" /> {t('retry')}
            </button>
            <button onClick={handleDismiss} className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
              {t('dismiss')}
            </button>
          </>
        )}

        {status === 'dismissed' && (
          <button onClick={handleReopen} className="rounded border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
            {t('reopen')}
          </button>
        )}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="bg-gray-50/50 px-8 py-3 dark:bg-gray-900/30">
            <div className="space-y-3">
          {/* When */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{t('when')}</p>
            <p className="text-xs text-gray-700 dark:text-gray-300">
              {t('firstSeen')}: {relativeTime(issue.first_seen, lang)} ({absoluteTime(issue.first_seen)})
              <br />
              {t('lastSeen')}: {relativeTime(issue.last_seen, lang)} ({absoluteTime(issue.last_seen)})
            </p>
          </div>

          {/* Where */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{t('where')}</p>
            <p className="text-xs text-gray-700 dark:text-gray-300">
              {issue.expanded?.page || '—'}
              {fileLine && <span className="ml-2 font-mono text-[10px] text-gray-400">{fileLine}</span>}
            </p>
          </div>

          {/* Who */}
          {issue.expanded?.user && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{t('who')}</p>
              <p className="text-xs text-gray-700 dark:text-gray-300">
                {t('detailRole')}: {issue.expanded.user.role} | {t('detailSport')}: {issue.expanded.user.sport}
              </p>
            </div>
          )}

          {/* What tried (breadcrumbs) */}
          {issue.expanded?.breadcrumbs?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{t('whatTried')}</p>
              <ol className="list-decimal list-inside text-xs text-gray-700 dark:text-gray-300 space-y-0.5">
                {issue.expanded.breadcrumbs.map((b, i) => <li key={i}>{b}</li>)}
              </ol>
            </div>
          )}

          {/* What went wrong */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{t('whatFailed')}</p>
            {issue.expanded?.status && (
              <p className="text-xs text-gray-500 mb-1">HTTP {issue.expanded.status} {issue.expanded.collection && `on ${issue.expanded.collection}`}</p>
            )}
            <pre className="text-xs font-mono max-h-48 overflow-auto bg-muted p-2 rounded">
              {issue.expanded?.stack || issue.message}
            </pre>
          </div>

          {/* Device */}
          {issue.expanded?.userAgent && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{t('device')}</p>
              <p className="text-xs text-gray-700 dark:text-gray-300">{parseUserAgent(issue.expanded.userAgent)}</p>
            </div>
          )}

          {/* Fix history */}
          {issue.fix_status && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{t('fixHistory')}</p>
              <p className="text-xs text-gray-700 dark:text-gray-300">
                Status: <StatusBadge status={issue.fix_status} t={t} />
                {(() => {
                  const safe = sanitizeUrl(issue.pr_url || '')
                  return safe ? (
                    <a href={safe} target="_blank" rel="noopener noreferrer"
                      className="ml-2 text-blue-600 hover:underline dark:text-blue-400">
                      PR <ExternalLink className="inline h-2.5 w-2.5" />
                    </a>
                  ) : null
                })()}
              </p>
            </div>
          )}
            </div>
          </TableCell>
        </TableRow>
      )}

      {/* Inline confirm dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">{t('statusTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-8">{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction className="text-xs h-8" onClick={() => { confirmAction?.onConfirm(); setConfirmAction(null) }}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ── Tabs ─────────────────────────────────────────────────────────────

type Tab = 'active' | 'deployed' | 'dismissed'

// ── Page ─────────────────────────────────────────────────────────────

export default function BugfixDashboardPage() {
  const { t, i18n } = useTranslation('bugfixes')
  const lang = i18n.language
  const { data: issues, isLoading, refetch } = useBugfixIssues()
  const [tab, setTab] = useState<Tab>('active')

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  const filterByTab = (issues: BugfixIssue[], t: Tab) => {
    switch (t) {
      case 'active':
        return issues.filter(i =>
          i.annotation?.status !== 'solved' &&
          (i.fix_status === null || i.fix_status === 'fixing' || i.fix_status === 'pr_ready' || i.fix_status === 'failed' || i.fix_status === 'reverted')
        )
      case 'deployed':
        return issues.filter(i =>
          i.fix_status === 'deployed_dev' || i.fix_status === 'deployed_prod'
        )
      case 'dismissed':
        return issues.filter(i => i.annotation?.status === 'solved')
      default:
        return issues
    }
  }

  const filtered = useMemo(() => issues ? filterByTab(issues, tab) : [], [issues, tab])

  const tabCounts = useMemo(() => {
    if (!issues) return { active: 0, deployed: 0, dismissed: 0 }
    return {
      active: filterByTab(issues, 'active').length,
      deployed: filterByTab(issues, 'deployed').length,
      dismissed: filterByTab(issues, 'dismissed').length,
    }
  }, [issues])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: t('tabActive') },
    { key: 'deployed', label: t('tabDeployed') },
    { key: 'dismissed', label: t('tabDismissed') },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
            <Bug className="h-5 w-5" />
            {t('title')}
          </h1>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {label}
            {issues && (
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-700">
                {tabCounts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50">
        {isLoading && !issues && <LoadingSpinner size="sm" />}

        {issues && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400">{t('noIssues')}</div>
        )}

        {filtered.length > 0 && (
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
            <Table>
              <TableBody>
                {filtered.map(issue => (
                  <IssueRow key={issue.hash} issue={issue} t={t} lang={lang} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
