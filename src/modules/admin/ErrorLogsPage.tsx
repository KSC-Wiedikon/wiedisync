import { useState, useCallback, useEffect } from 'react'
import IconButton from '@/components/IconButton'
import { Button } from '@/components/ui/button'
import { kscwApi } from '../../lib/api'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  FileWarning, RefreshCcw, ChevronDown, ChevronRight,
  Search, X, AlertCircle, AlertTriangle, CheckCircle2, Info,
  Archive, Star, BellOff, Trash2, RotateCcw,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useReportPageLoading } from '../../hooks/usePageReady'

// The website and the app both ship their errors to the same backend collector
// (POST-ed by the frontends, written by the backend). GET /kscw/admin/error-logs
// returns them merged; `project` distinguishes wiedisync vs kscw-website. This
// page is a viewer + light triage surface over that endpoint — annotations
// (archive/important, per occurrence) and mute rules (hide a whole category)
// both hit sibling endpoints; the log itself stays an immutable JSONL.
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
  level: 'error' | 'warn' | 'info'
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
  _muted?: { rule_id: number; note?: string | null } | null
  _context?: { user?: ErrorContextUser; record?: { label?: string; sport?: string } }
}

interface MuteRule {
  id: number
  event: string | null
  error_match: string
  note: string | null
  enabled: boolean
}

interface ErrorLogsResponse { data: ErrorLogEntry[] }
interface DatesResponse { data: { date: string; size: number; lines: number }[] }
interface MuteRulesResponse { data: MuteRule[] }

interface ErrorFilters {
  project: string
  level: string
  event: string
  date: string
  search: string
  showSolved: boolean
}

const PROJECTS = ['wiedisync', 'kscw-website']
// `info` is the SQL-workspace audit trail, not a finding — the endpoint keeps it
// out of the unfiltered view, so picking it here is the only way to see it.
const LEVELS = ['error', 'warn', 'info']
const EVENTS = [
  'api_error', 'auth_denied', 'auth_error', 'cron_error', 'client_error', 'unhandled_error',
  'unhandled_rejection', 'network_error', 'console_error', 'captcha_failed', 'push_send_failed',
  // Pre-boot watchdog (public/boot-watchdog.js): the page loaded but the app
  // never mounted / mounted late / was abandoned before mounting.
  'boot_stall', 'boot_recovered', 'boot_slow', 'boot_abandoned',
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function levelIcon(level: string) {
  if (level === 'warn') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
  if (level === 'info') return <Info className="h-3.5 w-3.5 text-sky-500" />
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
      <span className="font-medium text-muted-foreground">{label}:</span>
      <span className="ml-2 break-all text-foreground/85">{value}</span>
    </div>
  )
}

// Small pill button used for the per-row triage actions.
function ActionButton({ onClick, icon, label, tone = 'neutral' }: {
  onClick: (ev: React.MouseEvent) => void
  icon: React.ReactNode
  label: string
  tone?: 'neutral' | 'amber' | 'green'
}) {
  const tones = {
    neutral: 'text-muted-foreground',
    amber: 'border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800/50 dark:text-amber-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-300',
    green: 'border-green-200 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-800/50 dark:text-green-400 dark:hover:bg-green-900/20 dark:hover:text-green-300',
  }
  return (
    <Button size="sm" variant="outline" onClick={onClick} className={tones[tone]}>
      {icon}
      {label}
    </Button>
  )
}

function ErrorRow({ entry, selected, onToggleSelect, onFilterEvent, onAnnotate, onCreateMuteRule }: {
  entry: ErrorLogEntry
  selected: boolean
  onToggleSelect: (hash: string) => void
  onFilterEvent: (e: string) => void
  onAnnotate: (hash: string, status: 'solved' | 'important' | 'open') => void
  onCreateMuteRule: (event: string | null, errorMatch: string, note: string) => Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [expanded, setExpanded] = useState(false)
  const where = entry.source === 'frontend' ? entry.page : entry.endpoint
  const user = entry._context?.user
  const status = entry._annotation?.status
  const solved = status === 'solved'
  const important = status === 'important'

  // Inline "mute all like this" form — collapsed by default, prefilled from the row.
  const [muteOpen, setMuteOpen] = useState(false)
  const [muteEvent, setMuteEvent] = useState(entry.event)
  const [muteMatch, setMuteMatch] = useState(entry.error || '')
  const [muteNote, setMuteNote] = useState('')
  const [muteSaving, setMuteSaving] = useState(false)

  async function saveMute() {
    if (!muteMatch.trim() && !muteEvent) return
    setMuteSaving(true)
    try {
      await onCreateMuteRule(muteEvent || null, muteMatch.trim(), muteNote.trim())
      setMuteOpen(false)
    } finally {
      setMuteSaving(false)
    }
  }

  return (
    <>
      <TableRow
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer border-border/60"
      >
        <TableCell className="w-6 px-1">
          <input
            type="checkbox"
            checked={selected}
            onClick={(ev) => ev.stopPropagation()}
            onChange={() => onToggleSelect(entry._hash)}
            className="h-4 w-4 accent-[var(--primary)]"
            aria-label={t('errorLogsSelect')}
          />
        </TableCell>
        <TableCell className="w-6 px-1">
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/80" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/80" />}
        </TableCell>
        <TableCell className="hidden sm:table-cell whitespace-nowrap font-mono text-[10px] text-muted-foreground/80">
          {formatTs(entry.ts)}
        </TableCell>
        <TableCell className="w-6 px-1">
          {solved
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            : important
              ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
              : entry._muted
                ? <BellOff className="h-3.5 w-3.5 text-muted-foreground/80" />
                : levelIcon(entry.level)}
        </TableCell>
        <TableCell>
          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${projectBadge(entry.project)}`}>
            {entry.project === 'kscw-website' ? 'website' : entry.project}
          </span>
        </TableCell>
        <TableCell>
          <button
            onClick={(ev) => { ev.stopPropagation(); onFilterEvent(entry.event) }}
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-stone-200 dark:hover:bg-gray-600"
          >
            {entry.event}
          </button>
        </TableCell>
        <TableCell className="hidden md:table-cell max-w-[180px] truncate font-mono text-[10px] text-muted-foreground/80" title={where || ''}>
          {where}
        </TableCell>
        <TableCell className="max-w-[280px] truncate text-xs text-foreground/85" title={entry.error || ''}>
          {entry.error}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="border-border/60 bg-surface-sunken hover:bg-surface-sunken">
          <TableCell colSpan={8} className="whitespace-normal px-8 py-3">
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
                  <span className="font-medium text-muted-foreground">Body:</span>
                  <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-1.5 text-[10px] text-muted-foreground">{fmtVal(entry.body)}</pre>
                </div>
              ) : null}
              {entry.stack && (
                <div className="text-[11px]">
                  <span className="font-medium text-muted-foreground">Stack:</span>
                  <pre className="mt-0.5 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-muted p-1.5 text-[10px] text-muted-foreground">{entry.stack}</pre>
                </div>
              )}
              {entry._annotation && (
                <DetailLine
                  label="Annotation"
                  value={`${entry._annotation.status || ''}${entry._annotation.note ? ` — ${entry._annotation.note}` : ''}${entry._annotation.resolved_commit ? ` (${entry._annotation.resolved_commit})` : ''}`}
                />
              )}
              {entry._muted && (
                <DetailLine label={t('errorLogsMuted')} value={entry._muted.note || '—'} />
              )}
              <DetailLine label="Hash" value={<span className="font-mono">{entry._hash}</span>} />

              {/* Triage actions */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                {solved ? (
                  <ActionButton
                    onClick={(ev) => { ev.stopPropagation(); onAnnotate(entry._hash, 'open') }}
                    icon={<RotateCcw className="h-3 w-3" />}
                    label={t('errorLogsReopen')}
                  />
                ) : (
                  <ActionButton
                    onClick={(ev) => { ev.stopPropagation(); onAnnotate(entry._hash, 'solved') }}
                    icon={<Archive className="h-3 w-3" />}
                    label={t('errorLogsArchive')}
                    tone="green"
                  />
                )}
                <ActionButton
                  onClick={(ev) => { ev.stopPropagation(); onAnnotate(entry._hash, important ? 'open' : 'important') }}
                  icon={<Star className={`h-3 w-3 ${important ? 'fill-amber-400' : ''}`} />}
                  label={important ? t('errorLogsClearImportant') : t('errorLogsImportant')}
                  tone="amber"
                />
                <ActionButton
                  onClick={(ev) => { ev.stopPropagation(); setMuteOpen((o) => !o) }}
                  icon={<BellOff className="h-3 w-3" />}
                  label={t('errorLogsMuteLike')}
                />
              </div>

              {/* Inline mute-rule form */}
              {muteOpen && (
                <div
                  onClick={(ev) => ev.stopPropagation()}
                  className="mt-2 space-y-2 rounded-xl border border-hairline bg-card p-2.5"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-[10px] text-muted-foreground">
                      {t('errorLogsMuteEvent')}
                      <select
                        value={muteEvent}
                        onChange={(ev) => setMuteEvent(ev.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-input bg-card px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-gray-800"
                      >
                        <option value="">{t('errorLogsMuteAnyEvent')}</option>
                        {EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] text-muted-foreground">
                      {t('errorLogsMuteMatch')}
                      <input
                        type="text"
                        value={muteMatch}
                        onChange={(ev) => setMuteMatch(ev.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-input bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20"
                      />
                    </label>
                  </div>
                  <label className="block text-[10px] text-muted-foreground">
                    {t('errorLogsMuteNote')}
                    <input
                      type="text"
                      value={muteNote}
                      onChange={(ev) => setMuteNote(ev.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-input bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20"
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground/80">{t('errorLogsMuteHint')}</p>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={saveMute}
                      disabled={muteSaving || (!muteMatch.trim() && !muteEvent)}
                    >
                      <BellOff className="h-3 w-3" />
                      {t('errorLogsMuteSave')}
                    </Button>
                    <Button variant="outline"
                      onClick={() => setMuteOpen(false)}
                    >
                      {t('errorLogsCancel')}
                    </Button>
                  </div>
                </div>
              )}
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
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [muteRules, setMuteRules] = useState<MuteRule[]>([])
  const [rulesOpen, setRulesOpen] = useState(false)

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
      setSelected(new Set())
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

  const fetchMuteRules = useCallback(async () => {
    try {
      const res = await kscwApi('/admin/error-logs/mute-rules') as MuteRulesResponse
      setMuteRules(res.data || [])
    } catch {
      // non-critical — the mute panel just stays empty
    }
  }, [])

  useEffect(() => {
    // Initial load. fetchLogs() flips the loading flag synchronously — that's the
    // intended fetch-on-mount, not a cascading-render smell the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs()
    fetchDates()
    fetchMuteRules()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Patch one entry's annotation in place so triage feedback is immediate; the
  // row hides/re-sorts on the next refresh.
  function patchAnnotation(hashes: string[], status: 'solved' | 'important' | 'open') {
    setEntries((prev) => prev?.map((e) =>
      hashes.includes(e._hash) ? { ...e, _annotation: { ...e._annotation, status } } : e,
    ) ?? prev)
  }

  const annotate = useCallback(async (hash: string, status: 'solved' | 'important' | 'open') => {
    patchAnnotation([hash], status)
    try {
      await kscwApi('/admin/error-logs/annotate', {
        method: 'POST',
        body: { error_hash: hash, error_date: date || todayIso(), status },
      })
    } catch (err) {
      toast.error(t('errorLogsActionFailed'))
      toast.error(String(err))
    }
  }, [date, t])

  const bulkAnnotate = useCallback(async (status: 'solved' | 'important') => {
    const hashes = [...selected]
    if (!hashes.length) return
    patchAnnotation(hashes, status)
    setSelected(new Set())
    try {
      await kscwApi('/admin/error-logs/annotate-bulk', {
        method: 'POST',
        body: { error_hashes: hashes, error_date: date || todayIso(), status },
      })
      toast.success(t('errorLogsActionDone'))
    } catch (err) {
      toast.error(t('errorLogsActionFailed'))
      toast.error(String(err))
    }
  }, [selected, date, t])

  const createMuteRule = useCallback(async (ruleEvent: string | null, errorMatch: string, note: string) => {
    try {
      await kscwApi('/admin/error-logs/mute-rules', {
        method: 'POST',
        body: { event: ruleEvent, error_match: errorMatch, note: note || null },
      })
      toast.success(t('errorLogsMuteCreated'))
      await fetchMuteRules()
      await fetchLogs()
    } catch (err) {
      toast.error(t('errorLogsActionFailed'))
      toast.error(String(err))
    }
  }, [t, fetchMuteRules, fetchLogs])

  const toggleMuteRule = useCallback(async (rule: MuteRule) => {
    try {
      await kscwApi(`/admin/error-logs/mute-rules/${rule.id}`, {
        method: 'PATCH',
        body: { enabled: !rule.enabled },
      })
      await fetchMuteRules()
      await fetchLogs()
    } catch (err) {
      toast.error(t('errorLogsActionFailed'))
      toast.error(String(err))
    }
  }, [t, fetchMuteRules, fetchLogs])

  const deleteMuteRule = useCallback(async (id: number) => {
    try {
      await kscwApi(`/admin/error-logs/mute-rules/${id}`, { method: 'DELETE' })
      toast.success(t('errorLogsRuleDeleted'))
      await fetchMuteRules()
      await fetchLogs()
    } catch (err) {
      toast.error(t('errorLogsActionFailed'))
      toast.error(String(err))
    }
  }, [t, fetchMuteRules, fetchLogs])

  function toggleSelect(hash: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash); else next.add(hash)
      return next
    })
  }

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
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            <FileWarning className="h-5 w-5" />
            {t('errorLogsTitle')}
          </h1>
          <p className="text-xs text-muted-foreground">{t('errorLogsDescription')}</p>
        </div>
        <Button
          onClick={() => { fetchLogs(); fetchDates(); fetchMuteRules() }}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('errorLogsRefresh')}
        </Button>
      </div>

      {/* Mute rules */}
      <div className="rounded-2xl border border-hairline bg-card shadow-card">
        <button
          onClick={() => setRulesOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          {rulesOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/80" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/80" />}
          <BellOff className="h-3.5 w-3.5 text-muted-foreground/80" />
          <span className="text-xs font-semibold text-foreground/85">{t('errorLogsMuteRules')}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {muteRules.filter((r) => r.enabled).length}
          </span>
        </button>
        {rulesOpen && (
          <div className="border-t border-border/60 px-3 py-2">
            <p className="mb-2 text-[11px] text-muted-foreground">{t('errorLogsMuteRulesDesc')}</p>
            {muteRules.length === 0 ? (
              <p className="py-1 text-[11px] text-muted-foreground/80">{t('errorLogsNoMuteRules')}</p>
            ) : (
              <div className="space-y-1">
                {muteRules.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
                    <span className={`rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium ${r.enabled ? 'text-muted-foreground' : 'text-muted-foreground/60 line-through'}`}>
                      {r.event || t('errorLogsMuteAnyEvent')}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-[11px] ${r.enabled ? 'text-foreground/85' : 'text-muted-foreground/60 line-through'}`} title={r.error_match || t('errorLogsMuteAnyMessage')}>
                      {r.error_match || <span className="italic text-muted-foreground/80">{t('errorLogsMuteAnyMessage')}</span>}
                      {r.note ? <span className="ml-1 text-muted-foreground/80">— {r.note}</span> : null}
                    </span>
                    <Button size="sm" variant="outline"
                      onClick={() => toggleMuteRule(r)}
                    >
                      {r.enabled ? t('errorLogsDisable') : t('errorLogsEnable')}
                    </Button>
                    <IconButton size="sm" variant="outline"
                      onClick={() => deleteMuteRule(r.id)}
                      className="text-muted-foreground/80 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      label={t('errorLogsDelete')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-hairline bg-card p-3 shadow-card">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select
            value={project}
            onChange={(ev) => setProject(ev.target.value)}
            className="h-11 min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-xs dark:bg-gray-800"
          >
            <option value="">{t('errorLogsAllProjects')}</option>
            {PROJECTS.map((p) => <option key={p} value={p}>{p === 'kscw-website' ? 'website' : p}</option>)}
          </select>

          <select
            value={level}
            onChange={(ev) => setLevel(ev.target.value)}
            className="h-11 min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-xs dark:bg-gray-800"
          >
            <option value="">{t('errorLogsAllLevels')}</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>

          <select
            value={event}
            onChange={(ev) => setEvent(ev.target.value)}
            className="h-11 min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-xs dark:bg-gray-800"
          >
            <option value="">{t('errorLogsAllEvents')}</option>
            {EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>

          <select
            value={date}
            onChange={(ev) => setDate(ev.target.value)}
            className="h-11 min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-xs dark:bg-gray-800"
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
            className="col-span-2 h-11 min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-xs dark:bg-input/20"
          />

          <select
            value={limit}
            onChange={(ev) => setLimit(Number(ev.target.value))}
            className="h-11 min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-xs dark:bg-gray-800"
          >
            {[200, 500, 1000].map((n) => <option key={n} value={n}>{t('errorLogsLimit', { count: n })}</option>)}
          </select>

          <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={showSolved} onChange={(ev) => setShowSolved(ev.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            {t('errorLogsShowArchived')}
          </label>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button
            onClick={() => fetchLogs()}
            disabled={loading}
          >
            <Search className="h-3 w-3" />
            {t('errorLogsSearch')}
          </Button>
          {hasFilters && (
            <Button variant="outline"
              onClick={clearFilters}
            >
              <X className="h-3 w-3" />
              {t('errorLogsClear')}
            </Button>
          )}
          {entries && (
            <span className="ml-auto text-[10px] text-muted-foreground/80">
              {entries.length} {t('errorLogsResults')}
            </span>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900/50 dark:bg-brand-900/20">
          <span className="text-xs font-medium text-brand-700 dark:text-brand-300">
            {t('errorLogsSelected', { count: selected.size })}
          </span>
          <Button size="sm" variant="outline"
            onClick={() => bulkAnnotate('solved')}
            className="border-green-200 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-800/50 dark:text-green-400 dark:hover:bg-green-900/20 dark:hover:text-green-300"
          >
            <Archive className="h-3 w-3" />
            {t('errorLogsArchiveSelected')}
          </Button>
          <Button size="sm" variant="outline"
            onClick={() => bulkAnnotate('important')}
            className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800/50 dark:text-amber-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-300"
          >
            <Star className="h-3 w-3" />
            {t('errorLogsMarkImportant')}
          </Button>
          <Button size="sm" variant="outline"
            onClick={() => setSelected(new Set())}
            className="ml-auto"
          >
            <X className="h-3 w-3" />
            {t('errorLogsClear')}
          </Button>
        </div>
      )}

      {/* Results */}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
        {loading && !entries && (
          <div className="p-8 text-center text-sm text-muted-foreground/80">{t('errorLogsLoading')}</div>
        )}

        {entries && entries.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground/80">{t('errorLogsNoResults')}</div>
        )}

        {entries && entries.length > 0 && (
          <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 px-1" />
                  <TableHead className="w-6 px-1" />
                  <TableHead className="hidden sm:table-cell">{t('errorLogsWhen')}</TableHead>
                  <TableHead className="w-6 px-1" />
                  <TableHead>{t('errorLogsProject')}</TableHead>
                  <TableHead>{t('errorLogsEvent')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('errorLogsWhere')}</TableHead>
                  <TableHead>{t('errorLogsMessage')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, idx) => (
                  <ErrorRow
                    key={`${entry._hash}-${idx}`}
                    entry={entry}
                    selected={selected.has(entry._hash)}
                    onToggleSelect={toggleSelect}
                    onFilterEvent={(e) => { setEvent(e); fetchLogs({ event: e }) }}
                    onAnnotate={annotate}
                    onCreateMuteRule={createMuteRule}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
