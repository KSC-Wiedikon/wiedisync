import { useState, useCallback, useEffect } from 'react'
import { kscwApi } from '../../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ScrollText, RefreshCcw, ChevronDown, ChevronRight,
  Search, X, ChevronLeft, ChevronsLeft, ChevronsRight,
  AlertCircle, Info, AlertTriangle,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import DatePicker from '@/components/ui/DatePicker'
import { useReportPageLoading } from '../../hooks/usePageReady'

interface AuditEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  action: string
  collection: string
  record_id: string
  actor: string
  details: Record<string, unknown>
}

interface AuditResponse {
  items: AuditEntry[]
  total: number
  page: number
  perPage: number
  totalPages: number
  collections: string[]
}

interface AuditStats {
  today_events: number
  today_errors: number
  archive_days: number
}

interface AuditFilters {
  collection: string
  action: string
  level: string
  actor: string
  recordId: string
  search: string
  from: string
  to: string
}

const ACTIONS = ['create', 'update', 'delete', 'auth', 'system', 'error']
const LEVELS = ['info', 'warn', 'error']

function levelIcon(level: string) {
  switch (level) {
    case 'error':
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
    case 'warn':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
    default:
      return <Info className="h-3.5 w-3.5 text-blue-400" />
  }
}

function actionBadge(action: string) {
  const colors: Record<string, string> = {
    create: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    auth: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    system: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return colors[action] || colors.system
}

function formatTs(ts: string) {
  try {
    const d = new Date(ts)
    // Swiss-format dd.mm.yyyy + 24h HH:MM:SS regardless of user locale.
    // See CLAUDE.md → Time & Date Formatting.
    return d.toLocaleString('de-CH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
  } catch {
    return ts
  }
}

function DiffView({ changes }: { changes: Record<string, { old: unknown; new: unknown }> }) {
  return (
    <div className="space-y-1">
      {Object.entries(changes).map(([field, { old: oldVal, new: newVal }]) => (
        <div key={field} className="text-xs">
          <span className="font-medium text-gray-500 dark:text-gray-400">{field}:</span>
          <span className="ml-2 text-red-500 line-through">{JSON.stringify(oldVal)}</span>
          <span className="ml-2 text-green-600">{JSON.stringify(newVal)}</span>
        </div>
      ))}
    </div>
  )
}

function AuditRow({ entry, onFilterCollection, onFilterActor, onFilterRecord }: {
  entry: AuditEntry
  onFilterCollection: (c: string) => void
  onFilterActor: (a: string) => void
  onFilterRecord: (r: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Object.keys(entry.details).length > 0

  return (
    <>
      <TableRow
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`border-gray-100 dark:border-gray-700/50 ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <TableCell className="w-6 px-1">
          {hasDetails
            ? expanded
              ? <ChevronDown className="h-3 w-3 text-gray-400" />
              : <ChevronRight className="h-3 w-3 text-gray-400" />
            : null}
        </TableCell>
        <TableCell className="hidden sm:table-cell font-mono text-[10px] text-gray-400 dark:text-gray-500">
          {formatTs(entry.ts)}
        </TableCell>
        <TableCell className="w-6 px-1">{levelIcon(entry.level)}</TableCell>
        <TableCell>
          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${actionBadge(entry.action)}`}>
            {entry.action}
          </span>
        </TableCell>
        <TableCell>
          <button
            onClick={(ev) => { ev.stopPropagation(); onFilterCollection(entry.collection) }}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {entry.collection}
          </button>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          {entry.record_id && (
            <button
              onClick={(ev) => { ev.stopPropagation(); onFilterRecord(entry.record_id) }}
              className="font-mono text-[10px] text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
              title={entry.record_id}
            >
              {entry.record_id.substring(0, 12)}…
            </button>
          )}
        </TableCell>
        <TableCell className="hidden lg:table-cell text-right">
          {entry.actor && entry.actor !== 'system' ? (
            <button
              onClick={(ev) => { ev.stopPropagation(); onFilterActor(entry.actor) }}
              className="text-xs text-gray-500 hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-400"
              title={entry.actor}
            >
              {entry.actor}
            </button>
          ) : (
            <span className="text-[10px] text-gray-400">system</span>
          )}
        </TableCell>
      </TableRow>
      {expanded && hasDetails && (
        <TableRow className="border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-900/30 hover:bg-gray-50/50 dark:hover:bg-gray-900/30">
          <TableCell colSpan={7} className="whitespace-normal px-8 py-2">
            {entry.details.changes ? (
              <DiffView changes={entry.details.changes as Record<string, { old: unknown; new: unknown }>} />
            ) : (
              <pre className="whitespace-pre-wrap text-[10px] text-gray-500 dark:text-gray-400">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export default function AuditLogPage() {
  const { t } = useTranslation('admin')
  const [searchParams, setSearchParams] = useSearchParams()

  // Filters (initialized from URL params for cross-linking)
  const [collection, setCollection] = useState(searchParams.get('collection') || '')
  const [action, setAction] = useState(searchParams.get('action') || '')
  const [level, setLevel] = useState(searchParams.get('level') || '')
  const [actor, setActor] = useState(searchParams.get('actor') || '')
  const [recordId, setRecordId] = useState(searchParams.get('record_id') || '')
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [from, setFrom] = useState(searchParams.get('from') || '')
  const [to, setTo] = useState(searchParams.get('to') || '')

  const [page, setPage] = useState(1)
  // Starts true: the mount effect below immediately fires the initial fetch, and
  // that is exactly what the old effect's synchronous `setLoading(true)` did.
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<AuditResponse | null>(null)
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [availableCollections, setAvailableCollections] = useState<string[]>([])

  // Report to the app boot gate — see usePageReady.tsx. Only the very first
  // fetch (before any result exists) should hold the boot spinner; later
  // refetches keep the page visible and use the inline refresh state.
  useReportPageLoading(loading && !result)

  // The request itself. Every state write lives in a promise callback, so this
  // is safe to call straight from an effect.
  const runFetchLogs = useCallback((p: number, f: AuditFilters) => {
    return kscwApi('/admin/audit', {
      method: 'POST',
      body: {
        collection: f.collection, action: f.action, level: f.level, actor: f.actor,
        record_id: f.recordId, search: f.search, from: f.from, to: f.to,
        page: p, per_page: 100,
      },
    }).then(
      (raw) => {
        const res = raw as AuditResponse
        setResult(res)
        setPage(p)
        if (res.collections.length > 0) {
          setAvailableCollections(res.collections)
        }
        setLoading(false)
      },
      (err: unknown) => {
        toast.error(String(err))
        setLoading(false)
      },
    )
  }, [])

  const fetchLogs = useCallback(async (p = 1, override?: Partial<AuditFilters>) => {
    // Merge any explicit overrides over the current state. Callers that mutate a
    // filter and immediately search (filter-link click, clear) MUST pass the new
    // values here — reading them back from state in a deferred closure races the
    // async setState and would search with the previous filter values.
    const f: AuditFilters = { collection, action, level, actor, recordId, search, from, to, ...override }
    setLoading(true)
    await runFetchLogs(p, f)
  }, [collection, action, level, actor, recordId, search, from, to, runFetchLogs])

  const fetchStats = useCallback(() => {
    return kscwApi('/admin/audit/stats', { method: 'GET' }).then(
      (res) => { setStats(res as AuditStats) },
      () => { /* stats are non-critical */ },
    )
  }, [])

  // Initial load. `loading` already starts true (see above), so the effect body
  // performs no synchronous state write — it just fires the two requests with
  // the mount-time filter values (seeded from the URL params), exactly as the
  // old `fetchLogs(1)` closure did.
  useEffect(() => {
    void runFetchLogs(1, { collection, action, level, actor, recordId, search, from, to })
    void fetchStats()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(override?: Partial<AuditFilters>) {
    const f: AuditFilters = { collection, action, level, actor, recordId, search, from, to, ...override }
    // Update URL params for bookmarkability
    const params = new URLSearchParams()
    if (f.collection) params.set('collection', f.collection)
    if (f.action) params.set('action', f.action)
    if (f.level) params.set('level', f.level)
    if (f.actor) params.set('actor', f.actor)
    if (f.recordId) params.set('record_id', f.recordId)
    if (f.search) params.set('search', f.search)
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
    setSearchParams(params, { replace: true })
    fetchLogs(1, override)
  }

  function clearFilters() {
    setCollection('')
    setAction('')
    setLevel('')
    setActor('')
    setRecordId('')
    setSearch('')
    setFrom('')
    setTo('')
    setSearchParams({}, { replace: true })
    // Fetch with the cleared values explicitly — the setState calls above are
    // async, so a deferred fetch that read them back would still see the old ones.
    fetchLogs(1, { collection: '', action: '', level: '', actor: '', recordId: '', search: '', from: '', to: '' })
  }

  function setFilterAndSearch(key: string, value: string) {
    const override: Partial<AuditFilters> = {}
    if (key === 'collection') { setCollection(value); override.collection = value }
    if (key === 'actor') { setActor(value); override.actor = value }
    if (key === 'record_id') { setRecordId(value); override.recordId = value }
    // Search with the new value passed explicitly (state update is async).
    handleSearch(override)
  }

  const hasFilters = collection || action || level || actor || recordId || search || from || to

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
            <ScrollText className="h-5 w-5" />
            {t('auditTitle')}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('auditDescription')}</p>
        </div>
        <button
          onClick={() => { fetchLogs(page); fetchStats() }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('auditRefresh')}
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('auditToday')}</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{stats.today_events}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('auditTodayErrors')}</p>
            <p className={`text-lg font-bold ${stats.today_errors > 0 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
              {stats.today_errors}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{t('auditArchiveDays')}</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{stats.archive_days}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select
            value={collection}
            onChange={(ev) => setCollection(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('auditAllCollections')}</option>
            {availableCollections.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            value={action}
            onChange={(ev) => setAction(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('auditAllActions')}</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <select
            value={level}
            onChange={(ev) => setLevel(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('auditAllLevels')}</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>

          <input
            type="text"
            placeholder={t('auditRecordId')}
            value={recordId}
            onChange={(ev) => setRecordId(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />

          <input
            type="text"
            placeholder={t('auditActorId')}
            value={actor}
            onChange={(ev) => setActor(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />

          <input
            type="text"
            placeholder={t('auditSearchDetails')}
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />

          <DatePicker
            value={from}
            onChange={setFrom}
          />

          <DatePicker
            value={to}
            onChange={setTo}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => handleSearch()}
            disabled={loading}
            className="flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Search className="h-3 w-3" />
            {t('auditSearch')}
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <X className="h-3 w-3" />
              {t('auditClearFilters')}
            </button>
          )}
          {result && (
            <span className="ml-auto text-[10px] text-gray-400">
              {result.total} {t('auditResults')}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50">
        {loading && !result && (
          <div className="p-8 text-center text-sm text-gray-400">{t('auditLoading')}</div>
        )}

        {result && result.items.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400">{t('auditNoResults')}</div>
        )}

        {result && result.items.length > 0 && (
          <>
            <div className="max-h-[calc(100vh-380px)] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6 px-1" />
                    <TableHead className="hidden sm:table-cell text-[10px] uppercase text-gray-400">{t('auditWhen')}</TableHead>
                    <TableHead className="w-6 px-1" />
                    <TableHead className="text-[10px] uppercase text-gray-400">{t('auditAction')}</TableHead>
                    <TableHead className="text-[10px] uppercase text-gray-400">{t('auditCollection')}</TableHead>
                    <TableHead className="hidden md:table-cell text-[10px] uppercase text-gray-400">{t('auditRecord')}</TableHead>
                    <TableHead className="hidden lg:table-cell text-right text-[10px] uppercase text-gray-400">{t('auditActor')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((entry, idx) => (
                    <AuditRow
                      key={`${entry.ts}-${idx}`}
                      entry={entry}
                      onFilterCollection={(c) => setFilterAndSearch('collection', c)}
                      onFilterActor={(a) => setFilterAndSearch('actor', a)}
                      onFilterRecord={(r) => setFilterAndSearch('record_id', r)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {result.totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 border-t border-gray-100 px-3 py-2 dark:border-gray-700">
                <button
                  onClick={() => fetchLogs(1)}
                  disabled={page === 1}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => fetchLogs(page - 1)}
                  disabled={page === 1}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 text-xs text-gray-500">
                  {page} / {result.totalPages}
                </span>
                <button
                  onClick={() => fetchLogs(page + 1)}
                  disabled={page >= result.totalPages}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => fetchLogs(result.totalPages)}
                  disabled={page >= result.totalPages}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
