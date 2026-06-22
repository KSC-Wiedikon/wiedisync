import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { formatTimeZurich } from '../../utils/dateHelpers'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Wrench, XCircle, RefreshCcw, ScrollText,
} from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table'
import { useReportPageLoading } from '../../hooks/usePageReady'
import {
  runAllChecks, autoFix, autoFixAll,
  type CollectionHealth, type DataIssue, type IssueKey,
} from './utils/dataHealthChecks'

// Stable issueKey → i18n label key. Labels are resolved here (not in the check
// logic) so every issue is localized in all 5 locales.
const ISSUE_LABEL_KEY: Record<IssueKey, string> = {
  missingDate: 'dhIssueMissingDate',
  missingAwayTeam: 'dhIssueMissingAwayTeam',
  missingTime: 'dhIssueMissingTime',
  nonPaddedTime: 'dhIssueNonPaddedTime',
  noTeamAssignment: 'dhIssueNoTeamAssignment',
}

function severityIcon(severity: DataIssue['severity']) {
  return severity === 'error'
    ? <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
    : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
}

/** errors-before-warnings score; higher = more urgent. */
function urgency(h: CollectionHealth): number {
  const errors = h.issues.filter((i) => i.severity === 'error').length
  return errors * 1000 + h.issues.length
}

function CollectionCard({
  health,
  onFixed,
}: {
  health: CollectionHealth
  onFixed: () => void
}) {
  const { t } = useTranslation('admin')
  const [expanded, setExpanded] = useState(health.issues.length > 0)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [fixingAll, setFixingAll] = useState(false)

  const hasIssues = health.issues.length > 0
  const fixableCount = health.issues.filter((i) => i.autoFixable).length
  const errorCount = health.issues.filter((i) => i.severity === 'error').length
  const warningCount = health.issues.filter((i) => i.severity === 'warning').length
  const panelId = `dh-panel-${health.collection}`

  // Errors first, then alphabetical by stable issueKey so like issues cluster.
  const sortedIssues = [...health.issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
    return a.issueKey.localeCompare(b.issueKey)
  })

  async function handleFixOne(issue: DataIssue) {
    setFixingId(issue.id)
    try {
      await autoFix(issue)
      toast.success(`${t('dhFixed')}: ${issue.detail}`)
      onFixed()
    } catch {
      toast.error(t('dhFixFailed'))
    } finally {
      setFixingId(null)
    }
  }

  async function handleFixAll() {
    setFixingAll(true)
    try {
      const result = await autoFixAll(health.issues)
      if (result.failed > 0) {
        toast.warning(t('dhFixAllResult', { fixed: result.fixed, failed: result.failed }))
      } else {
        toast.success(t('dhFixAllResult', { fixed: result.fixed, failed: result.failed }))
      }
      onFixed()
    } catch {
      toast.error(t('dhFixFailed'))
    } finally {
      setFixingAll(false)
    }
  }

  const headerInner = (
    <>
      {hasIssues
        ? (expanded
          ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />)
        : <span className="h-4 w-4 shrink-0" />
      }
      <span className="text-sm font-semibold text-gray-900 dark:text-white">
        {health.collection}
      </span>
      <span className="text-xs text-gray-400 dark:text-gray-500">
        ({health.total} {t('dhRecords')})
      </span>
      <div className="ml-auto flex items-center gap-2">
        {!hasIssues ? (
          <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            {t('dhClean')}
          </span>
        ) : (
          <>
            {errorCount > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {errorCount} {errorCount === 1 ? t('dhError') : t('dhErrors')}
              </span>
            )}
            {warningCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {warningCount} {warningCount === 1 ? t('dhWarning') : t('dhWarnings')}
              </span>
            )}
          </>
        )}
      </div>
    </>
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50">
      {/* Header — interactive disclosure only when there are issues to reveal */}
      {hasIssues ? (
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left"
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3">
          {headerInner}
        </div>
      )}

      {/* Issues */}
      {expanded && hasIssues && (
        <div id={panelId} className="border-t border-gray-100 dark:border-gray-700">
          {/* Fix all (auto-fixable only) */}
          {fixableCount > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {fixableCount} {t('dhAutoFixable')}
              </span>
              <button
                onClick={handleFixAll}
                disabled={fixingAll}
                aria-busy={fixingAll}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:min-h-0"
              >
                <Wrench className="h-3 w-3" aria-hidden="true" />
                {fixingAll ? t('dhFixing') : t('dhFixAll')}
              </button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[42%]">{t('dhColIssue')}</TableHead>
                <TableHead>{t('dhColRecord')}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{t('dhColAction')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedIssues.map((issue) => (
                <TableRow key={`${issue.id}-${issue.field}-${issue.issueKey}`}>
                  <TableCell className="align-top">
                    <span className="flex items-center gap-2">
                      {severityIcon(issue.severity)}
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {t(ISSUE_LABEL_KEY[issue.issueKey])}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="align-top whitespace-normal break-words">
                    <p className="text-xs text-gray-600 dark:text-gray-300">
                      {issue.detail}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500">
                      <span>ID: {issue.id}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>{t('dhField')}: {issue.field}</span>
                      <Link
                        to={`/admin/audit-log?collection=${health.collection}&record_id=${issue.id}`}
                        className="inline-flex items-center gap-0.5 text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                        aria-label={`${t('dhViewHistory')} — ${issue.detail}`}
                      >
                        <ScrollText className="h-3 w-3" aria-hidden="true" />
                        {t('dhViewHistory')}
                      </Link>
                    </p>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {issue.autoFixable && (
                      <button
                        onClick={() => handleFixOne(issue)}
                        disabled={fixingId === issue.id}
                        aria-busy={fixingId === issue.id}
                        className={`inline-flex min-h-[44px] items-center justify-center rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 sm:min-h-0 ${
                          issue.fixAction === 'delete'
                            ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {fixingId === issue.id
                          ? t('dhFixing')
                          : issue.fixAction === 'delete' ? t('dhDelete') : t('dhFix')}
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

export default function DataHealthPage() {
  const { t } = useTranslation('admin')
  const [results, setResults] = useState<CollectionHealth[]>([])
  // Start in the loading state so the auto-scan shows the branded spinner
  // immediately rather than flashing the empty state for a frame.
  const [loading, setLoading] = useState(true)
  const [lastCheck, setLastCheck] = useState('')

  const runChecks = useCallback(async () => {
    setLoading(true)
    try {
      const data = await runAllChecks()
      setResults(data)
      setLastCheck(formatTimeZurich(new Date()))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-run once on mount — checks are read-only, mirroring InfraHealthPage.
  // runChecks flips `loading` synchronously (intentional one-shot mount fetch),
  // so the set-state-in-effect warning is expected here.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { runChecks() }, [])

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0)
  const totalErrors = results.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.severity === 'error').length, 0)
  const totalWarnings = totalIssues - totalErrors

  // Collections with issues (most urgent first) above the clean ones.
  const sortedResults = [...results].sort((a, b) => urgency(b) - urgency(a))

  const initialScan = loading && results.length === 0

  // Report to app boot gate — see usePageReady.tsx
  useReportPageLoading(initialScan)

  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('dhTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('dhDescription')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastCheck && (
            <span className="hidden text-xs text-gray-400 sm:inline dark:text-gray-500">
              {lastCheck}
            </span>
          )}
          <button
            onClick={runChecks}
            disabled={loading}
            aria-busy={loading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            {loading ? (
              <>
                <RefreshCcw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {t('dhScanning')}
              </>
            ) : (
              <>
                <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {results.length > 0 ? t('dhRescan') : t('dhScan')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Initial scan — branded "load everything then render" spinner */}
      {initialScan ? null : (
        <>
          {/* Summary (live region announces scan result to screen readers) */}
          {results.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/30"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {totalIssues === 0 ? (
                  <span className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">
                      {t('dhAllClean')}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('dhIssuesFound', { count: totalIssues })}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {totalErrors > 0 && (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          {totalErrors} {totalErrors === 1 ? t('dhError') : t('dhErrors')}
                        </span>
                      )}
                      {totalWarnings > 0 && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          {totalWarnings} {totalWarnings === 1 ? t('dhWarning') : t('dhWarnings')}
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Fallback empty state (only if a scan returned nothing, e.g. on error) */}
          {!loading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-800">
                <AlertTriangle className="h-8 w-8 text-gray-400" aria-hidden="true" />
              </div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('dhEmptyTitle')}
              </p>
              <p className="mb-6 text-xs text-gray-500 dark:text-gray-400">
                {t('dhEmptyDescription')}
              </p>
              <button
                onClick={runChecks}
                disabled={loading}
                className="min-h-[44px] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {t('dhScan')}
              </button>
            </div>
          )}

          {/* Collection cards — dimmed while a rescan is in flight */}
          <div className={`space-y-4 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}>
            {sortedResults.map((health) => (
              <CollectionCard key={health.collection} health={health} onFixed={runChecks} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
