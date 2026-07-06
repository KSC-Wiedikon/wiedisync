import { useState, useCallback, useEffect } from 'react'
import { kscwApi } from '../../lib/api'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  FileWarning, RefreshCcw, ChevronDown, ChevronRight,
  Search, X, AlertCircle, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useReportPageLoading } from '../../hooks/usePageReady'

// The website and the app both ship their errors to the same backend collector
// (POST-ed by the frontends, written by the backend). GET /kscw/admin/error-logs
// returns them merged; `project` distinguishes wiedisync vs kscw-website. This
// page is a thin read-only viewer over that endpoint — no new backend needed.
interface ErrorContextUser {
  name?: string
  role?: string[]
  teams?: { team: string; sport: string }[]
}

interface ErrorAnnotation {
  status?: string
  note?: string
  resolved_commit?: string
  date_updated?: string
}

interface ErrorLogEntry {
  ts: string
  level: 'error' | 'warn'
  source: 'frontend' | null
  project: string
  event: string
  userId: string | null
  endpoint: string | null
  method: string | null
  status: number | null
  error: string | null
  stack: string | null
  page: string | null
  userAgent: string | null
  body?: unknown
  payload?: unknown
  responseBody?: unknown
  ip?: string | null
  cron?: string | null
  _hash: string
  _annotation: ErrorAnnotation | null
  _context?: { user?: ErrorContextUser; record?: { label?: string; sport?: string } }
}

interface ErrorLogsResponse { data: ErrorLogEntry[] }
interface DatesResponse { data: { date: string; size: number; lines: number }[] }

interface ErrorFilters {
  project: string
  level: string
  event: string
  date: string
  search: string
  showSolved: boolean
}

const PROJECTS = ['wiedisync', 'kscw-website']
const LEVELS = ['error', 'warn']
const EVENTS = [
  'api_error', 'auth_denied', 'cron_error', 'client_error', 'unhandled_error',
  'unhandled_rejection', 'network_error', 'console_error', 'captcha_failed', 'push_send_failed',
]

function levelIcon(level: string) {
  if (level === 'warn') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
  return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
}

function projectBadge(project: string) {
  return project === 'kscw-website'
    ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
    : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
}

function formatTs(ts: string) {
  try {
    // Swiss dd.mm.yyyy + 24h HH:MM:SS regardless of user locale (CLAUDE.md → Time & Date).
    return new Date(ts).toLocaleString('de-CH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return ts }
}

function fmtVal(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function DetailLine({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="text-[11px]">
      <span className="font-medium text-gray-500 dark:text-gray-400">{label}:</span>
      <span className="ml-2 break-all text-gray-700 dark:text-gray-300">{value}</span>
    </div>
  )
}

function ErrorRow({ entry, onFilterEvent }: { entry: ErrorLogEntry; onFilterEvent: (e: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const where = entry.source === 'frontend' ? entry.page : entry.endpoint
  const user = entry._context?.user
  const solved = entry._annotation?.status === 'solved'

  return (
    <>
      <TableRow
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer border-gray-100 dark:border-gray-700/50"
      >
        <TableCell className="w-6 px-1">
          {expanded ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />}
        </TableCell>
        <TableCell className="hidden sm:table-cell whitespace-nowrap font-mono text-[10px] text-gray-400 dark:text-gray-500">
          {formatTs(entry.ts)}
        </TableCell>
        <TableCell className="w-6 px-1">
          {solved ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : levelIcon(entry.level)}
        </TableCell>
        <TableCell>
          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${projectBadge(entry.project)}`}>
            {entry.project === 'kscw-website' ? 'website' : entry.project}
          </span>
        </TableCell>
        <TableCell>
          <button
            onClick={(ev) => { ev.stopPropagation(); onFilterEvent(entry.event) }}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {entry.event}
          </button>
        </TableCell>
        <TableCell className="hidden md:table-cell max-w-[180px] truncate font-mono text-[10px] text-gray-400" title={where || ''}>
          {where}
        </TableCell>
        <TableCell className="max-w-[280px] truncate text-xs text-gray-700 dark:text-gray-300" title={entry.error || ''}>
          {entry.error}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="border-gray-100 bg-gray-50/50 hover:bg-gray-50/50 dark:border-gray-700/50 dark:bg-gray-900/30 dark:hover:bg-gray-900/30">
          <TableCell colSpan={7} className="whitespace-normal px-8 py-3">
            <div className="space-y-1">
              <DetailLine label="Error" value={entry.error} />
              <DetailLine label="Source" value={entry.source === 'frontend' ? 'frontend' : 'backend'} />
              <DetailLine label="Level" value={entry.level} />
              <DetailLine label="Page" value={entry.page} />
              <DetailLine label="Endpoint" value={entry.endpoint ? `${entry.method || 'GET'} ${entry.endpoint}${entry.status ? ` → ${entry.status}` : ''}` : null} />
              {user?.name && (
                <DetailLine
                  label="User"
                  value={`${user.name}${user.role?.length ? ` (${user.role.join(', ')})` : ''}${user.teams?.length ? ` — ${user.teams.map((tm) => tm.team).join(', ')}` : ''}`}
                />
              )}
              <DetailLine label="IP" value={entry.ip} />
              <DetailLine label="Cron" value={entry.cron} />
              <DetailLine label="User agent" value={entry.userAgent} />
              {(entry.body != null && fmtVal(entry.body)) ? (
                <div className="text-[11px]">
                  <span className="font-medium text-gray-500 dark:text-gray-400">Body:</span>
                  <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-1.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">{fmtVal(entry.body)}</pre>
                </div>
              ) : null}
              {entry.stack && (
                <div className="text-[11px]">
                  <span className="font-medium text-gray-500 dark:text-gray-400">Stack:</span>
                  <pre className="mt-0.5 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-1.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">{entry.stack}</pre>
                </div>
              )}
              {entry._annotation && (
                <DetailLine
                  label="Annotation"
                  value={`${entry._annotation.status || ''}${entry._annotation.note ? ` — ${entry._annotation.note}` : ''}${entry._annotation.resolved_commit ? ` (${entry._annotation.resolved_commit})` : ''}`}
                />
              )}
              <DetailLine label="Hash" value={<span className="font-mono">{entry._hash}</span>} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export default function ErrorLogsPage() {
  const { t } = useTranslation('admin')

  const [project, setProject] = useState('')
  const [level, setLevel] = useState('')
  const [event, setEvent] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [showSolved, setShowSolved] = useState(false)
  const [limit, setLimit] = useState(200)

  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<ErrorLogEntry[] | null>(null)
  const [dates, setDates] = useState<string[]>([])

  // Only the very first fetch holds the app boot gate; later refetches keep the
  // page visible and use the inline refresh spinner. See usePageReady.tsx.
  useReportPageLoading(loading && !entries)

  const fetchLogs = useCallback(async (override?: Partial<ErrorFilters>) => {
    const f: ErrorFilters = { project, level, event, date, search, showSolved, ...override }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.date) params.set('date', f.date)
      if (f.project) params.set('project', f.project)
      if (f.level) params.set('level', f.level)
      if (f.event) params.set('event', f.event)
      if (f.search) params.set('search', f.search)
      if (f.showSolved) params.set('show_solved', 'true')
      params.set('limit', String(limit))
      const res = await kscwApi(`/admin/error-logs?${params.toString()}`) as ErrorLogsResponse
      setEntries(res.data || [])
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [project, level, event, date, search, showSolved, limit])

  const fetchDates = useCallback(async () => {
    try {
      const res = await kscwApi('/admin/error-logs/dates') as DatesResponse
      setDates((res.data || []).map((d) => d.date))
    } catch {
      // date list is non-critical — the date picker just stays empty (= today)
    }
  }, [])

  useEffect(() => {
    // Initial load. fetchLogs() flips the loading flag synchronously — that's the
    // intended fetch-on-mount, not a cascading-render smell the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs()
    fetchDates()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function clearFilters() {
    setProject('')
    setLevel('')
    setEvent('')
    setDate('')
    setSearch('')
    setShowSolved(false)
    fetchLogs({ project: '', level: '', event: '', date: '', search: '', showSolved: false })
  }

  const hasFilters = project || level || event || date || search || showSolved

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
            <FileWarning className="h-5 w-5" />
            {t('errorLogsTitle')}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('errorLogsDescription')}</p>
        </div>
        <button
          onClick={() => { fetchLogs(); fetchDates() }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('errorLogsRefresh')}
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select
            value={project}
            onChange={(ev) => setProject(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('errorLogsAllProjects')}</option>
            {PROJECTS.map((p) => <option key={p} value={p}>{p === 'kscw-website' ? 'website' : p}</option>)}
          </select>

          <select
            value={level}
            onChange={(ev) => setLevel(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('errorLogsAllLevels')}</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>

          <select
            value={event}
            onChange={(ev) => setEvent(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('errorLogsAllEvents')}</option>
            {EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>

          <select
            value={date}
            onChange={(ev) => setDate(ev.target.value)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">{t('errorLogsToday')}</option>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>

          <input
            type="text"
            placeholder={t('errorLogsSearchPlaceholder')}
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === 'Enter') fetchLogs() }}
            className="col-span-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />

          <select
            value={limit}
            onChange={(ev) => setLimit(Number(ev.target.value))}
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            {[200, 500, 1000].map((n) => <option key={n} value={n}>{t('errorLogsLimit', { count: n })}</option>)}
          </select>

          <label className="flex items-center gap-1.5 px-1 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={showSolved} onChange={(ev) => setShowSolved(ev.target.checked)} className="h-3.5 w-3.5" />
            {t('errorLogsShowSolved')}
          </label>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => fetchLogs()}
            disabled={loading}
            className="flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Search className="h-3 w-3" />
            {t('errorLogsSearch')}
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <X className="h-3 w-3" />
              {t('errorLogsClear')}
            </button>
          )}
          {entries && (
            <span className="ml-auto text-[10px] text-gray-400">
              {entries.length} {t('errorLogsResults')}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50">
        {loading && !entries && (
          <div className="p-8 text-center text-sm text-gray-400">{t('errorLogsLoading')}</div>
        )}

        {entries && entries.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400">{t('errorLogsNoResults')}</div>
        )}

        {entries && entries.length > 0 && (
          <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 px-1" />
                  <TableHead className="hidden sm:table-cell text-[10px] uppercase text-gray-400">{t('errorLogsWhen')}</TableHead>
                  <TableHead className="w-6 px-1" />
                  <TableHead className="text-[10px] uppercase text-gray-400">{t('errorLogsProject')}</TableHead>
                  <TableHead className="text-[10px] uppercase text-gray-400">{t('errorLogsEvent')}</TableHead>
                  <TableHead className="hidden md:table-cell text-[10px] uppercase text-gray-400">{t('errorLogsWhere')}</TableHead>
                  <TableHead className="text-[10px] uppercase text-gray-400">{t('errorLogsMessage')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, idx) => (
                  <ErrorRow key={`${entry._hash}-${idx}`} entry={entry} onFilterEvent={(e) => { setEvent(e); fetchLogs({ event: e }) }} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
