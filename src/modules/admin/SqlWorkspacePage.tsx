// src/modules/admin/SqlWorkspacePage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Loader2, AlertTriangle, History, Database, RefreshCw, X, FileDown, FileSpreadsheet, ClipboardCopy, Check, Sparkles } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { API_URL, getAccessToken } from '../../lib/api'
import CodeMirrorEditor, { type SqlSchemaTable } from './components/CodeMirrorEditor'
import ResultsTable from './components/ResultsTable'
import { toCSV, toXlsx, copyAsTable, downloadBlob, downloadText } from './utils/exportResults'

interface SchemaColumn {
  name: string
  data_type: string
  nullable: boolean
}
interface SchemaTable {
  name: string
  columns: SchemaColumn[]
}
interface ApiSchemaResponse {
  tables: SchemaTable[]
}
interface ApiQueryResponse {
  columns: string[]
  rows: unknown[][]
  row_count: number
  duration_ms: number
  truncated: boolean
  statements: number
  write_mode: boolean
}
interface ApiErrorResponse {
  error: string
  code?: string | null
  detail?: string | null
  hint?: string | null
  position?: string | null
  statement_index?: number | null
  duration_ms?: number
}

interface RecentQuery {
  sql: string
  ts: number
}

const RECENT_KEY = 'kscw-sql-workspace-recent'
const DRAFT_KEY = 'kscw-sql-workspace-draft'
const MAX_RECENT = 20

function loadRecent(): RecentQuery[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function saveRecent(list: RecentQuery[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))) } catch { /* quota */ }
}

async function fetchSchema(): Promise<SchemaTable[]> {
  const token = getAccessToken()
  const resp = await fetch(`${API_URL}/kscw/admin/sql/schema`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!resp.ok) throw new Error(`schema fetch failed: ${resp.status}`)
  const data: ApiSchemaResponse = await resp.json()
  return data.tables
}

async function runQuery(sql: string, writeMode: boolean): Promise<ApiQueryResponse> {
  const token = getAccessToken()
  const resp = await fetch(`${API_URL}/kscw/admin/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ sql, write_mode: writeMode }),
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const errBody = body as ApiErrorResponse
    const err = new Error(errBody?.error ?? `query failed: ${resp.status}`) as Error & {
      code?: string | null
      detail?: string | null
      hint?: string | null
      position?: string | null
    }
    err.code = errBody?.code ?? null
    err.detail = errBody?.detail ?? null
    err.hint = errBody?.hint ?? null
    err.position = errBody?.position ?? null
    throw err
  }
  return body as ApiQueryResponse
}

interface AskAiResponse {
  sql: string
  model: string
  duration_ms: number
  tokens_in: number | null
  tokens_cached: number | null
  tokens_out: number | null
}

async function askAi(prompt: string): Promise<AskAiResponse> {
  const token = getAccessToken()
  const resp = await fetch(`${API_URL}/kscw/admin/sql/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ prompt }),
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = new Error((body as ApiErrorResponse)?.error ?? `AI request failed: ${resp.status}`)
    ;(err as Error & { code?: string | null }).code = (body as ApiErrorResponse)?.code ?? null
    throw err
  }
  return body as AskAiResponse
}

export default function SqlWorkspacePage() {
  const { t } = useTranslation('admin')

  const [sql, setSql] = useState<string>(() => {
    try { return localStorage.getItem(DRAFT_KEY) ?? '' } catch { return '' }
  })
  const [writeMode, setWriteMode] = useState(false)
  const [tables, setTables] = useState<SchemaTable[]>([])
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [tableFilter, setTableFilter] = useState('')
  const [expandedTable, setExpandedTable] = useState<string | null>(null)

  const [result, setResult] = useState<ApiQueryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [errorHint, setErrorHint] = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [recent, setRecent] = useState<RecentQuery[]>(() => loadRecent())
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'table' | null>(null)

  // ── AI assistant ──
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // aiMeta tracked for potential future inline-badge UI; null until first ask
  const [, setAiMeta] = useState<AskAiResponse | null>(null)

  // Persist draft to localStorage (debounced)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, sql) } catch { /* quota */ }
    }, 400)
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current) }
  }, [sql])

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true)
    try { setTables(await fetchSchema()) } catch (e) { console.warn('[sql-workspace] schema:', e) }
    finally { setSchemaLoading(false) }
  }, [])

  useEffect(() => { void loadSchema() }, [loadSchema])

  // Map → SqlSchemaTable for autocomplete (column names + types)
  const editorTables = useMemo<SqlSchemaTable[]>(
    () =>
      tables.map((tb) => ({
        name: tb.name,
        columns: tb.columns.map((c) => ({ name: c.name, dataType: c.data_type })),
      })),
    [tables],
  )

  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase()
    if (!q) return tables
    return tables.filter((tb) =>
      tb.name.toLowerCase().includes(q) ||
      tb.columns.some((c) => c.name.toLowerCase().includes(q)),
    )
  }, [tables, tableFilter])

  const execute = useCallback(async () => {
    const text = sql.trim()
    if (!text || loading) return
    setLoading(true)
    setError(null)
    setErrorCode(null)
    setErrorHint(null)
    setErrorDetail(null)
    try {
      const r = await runQuery(text, writeMode)
      setResult(r)
      const next = [{ sql: text, ts: Date.now() }, ...recent.filter((q) => q.sql !== text)]
      setRecent(next)
      saveRecent(next)
    } catch (e) {
      const ex = e as Error & { code?: string | null; hint?: string | null; detail?: string | null }
      setError(ex.message)
      setErrorCode(ex.code ?? null)
      setErrorHint(ex.hint ?? null)
      setErrorDetail(ex.detail ?? null)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [sql, writeMode, loading, recent])

  const insertTableRef = useCallback(
    (name: string) => setSql((cur) => (cur.trim() ? cur : `SELECT * FROM ${name} LIMIT 100;`)),
    [],
  )

  const clearRecent = useCallback(() => { setRecent([]); saveRecent([]) }, [])

  const exportFilename = useCallback((ext: string) => {
    const ts = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .replace(/\..+$/, '')
    return `kscw-sql-${ts}.${ext}`
  }, [])

  const handleExportCsv = useCallback(() => {
    if (!result) return
    setExporting('csv')
    try {
      const text = toCSV(result.columns, result.rows)
      downloadText(text, exportFilename('csv'), 'text/csv;charset=utf-8')
    } finally {
      setExporting(null)
    }
  }, [result, exportFilename])

  const handleExportXlsx = useCallback(async () => {
    if (!result) return
    setExporting('xlsx')
    try {
      const blob = await toXlsx(result.columns, result.rows)
      downloadBlob(blob, exportFilename('xlsx'))
    } finally {
      setExporting(null)
    }
  }, [result, exportFilename])

  const handleAskAi = useCallback(async () => {
    const text = aiPrompt.trim()
    if (!text || aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      const r = await askAi(text)
      setSql(r.sql)
      setAiMeta(r)
      setAiOpen(false)
    } catch (e) {
      setAiError((e as Error).message)
    } finally {
      setAiLoading(false)
    }
  }, [aiPrompt, aiLoading])

  const handleCopyTable = useCallback(async () => {
    if (!result) return
    setExporting('table')
    try {
      await copyAsTable(result.columns, result.rows)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (e) {
      console.warn('[sql-workspace] copy failed:', e)
    } finally {
      setExporting(null)
    }
  }, [result])

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 md:px-4">
        <h1 className="hidden text-sm font-bold text-primary md:block">{t('sqlWorkspaceTitle')}</h1>
        <span className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground md:inline" title={t('sqlWorkspaceDialectHint')}>
          PostgreSQL 15.8
        </span>
        <div className="flex-1" />

        <Popover open={aiOpen} onOpenChange={setAiOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
              title={t('sqlWorkspaceAskAiHint')}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('sqlWorkspaceAskAi')}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-[380px] p-3 sm:w-[440px]">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-sm font-semibold">{t('sqlWorkspaceAskAi')}</h2>
              <span className="ml-auto text-[10px] text-muted-foreground">{t('sqlWorkspaceAskAiTagline')}</span>
            </div>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleAskAi()
                }
              }}
              placeholder={t('sqlWorkspaceAskAiPlaceholder')}
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-background p-2 text-xs"
              autoFocus
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{t('sqlWorkspaceAskAiSubmitHint')}</span>
              <button
                type="button"
                onClick={() => void handleAskAi()}
                disabled={aiLoading || !aiPrompt.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {t('sqlWorkspaceAskAiGenerate')}
              </button>
            </div>
            {aiError && (
              <div className="mt-2 rounded-md border border-destructive bg-destructive/10 p-2 text-[11px] text-destructive">
                {aiError}
              </div>
            )}
          </PopoverContent>
        </Popover>

        <label className="flex items-center gap-1.5 text-xs text-foreground">
          <input
            type="checkbox"
            checked={writeMode}
            onChange={(e) => setWriteMode(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span className={writeMode ? 'font-semibold text-destructive' : ''}>{t('sqlWorkspaceWriteMode')}</span>
        </label>
        <button
          type="button"
          onClick={execute}
          disabled={loading || !sql.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          title={t('sqlWorkspaceRunHint')}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {t('sqlWorkspaceRun')}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar: schema */}
        <aside className="hidden w-[260px] flex-shrink-0 overflow-y-auto border-r border-border bg-card p-2 md:block">
          <div className="mb-2 flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">{t('sqlWorkspaceSchema')}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{tables.length}</span>
            <button
              type="button"
              onClick={() => void loadSchema()}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              title={t('sqlWorkspaceRefreshSchema')}
            >
              <RefreshCw className={`h-3 w-3 ${schemaLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <input
            type="text"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder={t('sqlWorkspaceFilterTables')}
            className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <ul className="text-xs">
            {filteredTables.map((tb) => {
              const open = expandedTable === tb.name
              return (
                <li key={tb.name} className="mb-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpandedTable(open ? null : tb.name)}
                      className="flex-1 truncate rounded px-1.5 py-0.5 text-left font-mono hover:bg-muted"
                      title={tb.name}
                    >
                      {tb.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertTableRef(tb.name)}
                      className="rounded px-1 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                      title={t('sqlWorkspaceInsertSelect')}
                    >
                      SELECT
                    </button>
                  </div>
                  {open && (
                    <ul className="ml-3 border-l border-border pl-2 text-[11px] text-muted-foreground">
                      {tb.columns.map((c) => (
                        <li key={c.name} className="truncate" title={`${c.name} :: ${c.data_type}${c.nullable ? '?' : ''}`}>
                          <span className="font-mono text-foreground">{c.name}</span>
                          <span className="ml-1 text-muted-foreground">{c.data_type}{c.nullable ? '?' : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
            {!schemaLoading && filteredTables.length === 0 && (
              <li className="px-1.5 py-2 text-muted-foreground">{t('sqlWorkspaceNoTables')}</li>
            )}
          </ul>
        </aside>

        {/* Main: editor + results */}
        <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          <CodeMirrorEditor
            value={sql}
            onChange={setSql}
            onExecute={execute}
            tables={editorTables}
            placeholder={t('sqlWorkspacePlaceholder')}
          />

          {/* Recent strip */}
          {recent.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto">
              <History className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{t('sqlWorkspaceRecent')}</span>
              {recent.slice(0, 10).map((r) => (
                <button
                  key={r.ts}
                  type="button"
                  onClick={() => setSql(r.sql)}
                  title={r.sql}
                  className="max-w-[200px] truncate rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted"
                >
                  {r.sql.replace(/\s+/g, ' ').slice(0, 60)}
                </button>
              ))}
              <button
                type="button"
                onClick={clearRecent}
                className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                title={t('sqlWorkspaceClearRecent')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Status bar + export toolbar */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {result && (
              <>
                <span>{t('sqlWorkspaceRows', { count: result.row_count })}</span>
                <span>· {t('sqlWorkspaceDuration', { ms: result.duration_ms })}</span>
                {result.statements > 1 && <span>· {t('sqlWorkspaceStatements', { count: result.statements })}</span>}
                {result.truncated && <span className="font-semibold text-amber-600">· {t('sqlWorkspaceTruncated')}</span>}
                {result.write_mode && <span className="font-semibold text-destructive">· WRITE</span>}
                {result.rows.length > 0 && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      disabled={exporting !== null}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                      title={t('sqlWorkspaceExportCsv')}
                    >
                      <FileDown className="h-3 w-3" />
                      {t('sqlWorkspaceExportCsv')}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportXlsx}
                      disabled={exporting !== null}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                      title={t('sqlWorkspaceExportXlsx')}
                    >
                      {exporting === 'xlsx' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
                      {t('sqlWorkspaceExportXlsx')}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyTable}
                      disabled={exporting !== null}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                      title={t('sqlWorkspaceCopyTableHint')}
                    >
                      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <ClipboardCopy className="h-3 w-3" />}
                      {copied ? t('sqlWorkspaceCopied') : t('sqlWorkspaceCopyTable')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 break-words">
                <div className="font-semibold">
                  {t('sqlWorkspaceError')}
                  {errorCode && <span className="ml-1.5 font-mono text-[10px] opacity-75">[{errorCode}]</span>}
                </div>
                <div className="font-mono">{error}</div>
                {errorHint && (
                  <div className="mt-1 font-mono text-foreground/80">
                    <span className="font-sans font-semibold">hint:</span> {errorHint}
                  </div>
                )}
                {errorDetail && (
                  <div className="mt-1 font-mono text-foreground/80">
                    <span className="font-sans font-semibold">detail:</span> {errorDetail}
                  </div>
                )}
                {errorCode === 'write_required' && (
                  <div className="mt-1 text-foreground/80">{t('sqlWorkspaceWriteRequiredHint')}</div>
                )}
              </div>
            </div>
          )}

          {result && (
            <ResultsTable columns={result.columns} rows={result.rows} maxHeight="max-h-[55vh]" />
          )}
        </main>
      </div>
    </div>
  )
}
