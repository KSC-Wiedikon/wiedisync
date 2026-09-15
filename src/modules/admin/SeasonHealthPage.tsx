// src/modules/admin/SeasonHealthPage.tsx
//
// Season health — the superadmin's "is this season set up correctly?" page.
// One fetch (`GET /kscw/admin/season-health`) returns every active team, every
// core roster player and the check registry's findings; this page only
// buckets them into Volleyball · Basketball · Club-wide and renders lists.
//
// Not a replacement for /admin/data-health (ClubDesk + record hygiene) or
// /admin/club-stats (counts): where a check exists there, this page links.
//
// LAYOUT per sport tab: KPI tiles → Teams table → Players table (filters) →
// one collapsible section per registry section (players, teams, finance,
// games, duties, rsvp, trainings, events) listing its checks error → warn →
// info, each expandable to a <Table> of the offending rows + xlsx export.
// Club-wide holds club-grain checks and rows whose sport is NULL/unknown.
//
// ⚠ Single fetch on purpose — no Promise.all fan-out to blank. The server
// runs every check in its own transaction and reports a failed one as
// `error: 'check_failed'` (rendered as a red pill), never as a 500.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCcw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { kscwApi } from '../../lib/api'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { formatTimeZurich } from '../../utils/dateHelpers'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import VolleyballIcon from '../../components/VolleyballIcon'
import BasketballIcon from '../../components/BasketballIcon'
import SeasonKpiTiles from './components/seasonHealth/SeasonKpiTiles'
import TeamSummaryTable from './components/seasonHealth/TeamSummaryTable'
import PlayerStatusTable from './components/seasonHealth/PlayerStatusTable'
import FindingSection from './components/seasonHealth/FindingSection'
import {
  SEASON_TABS, STALE_AFTER_DAYS, checksForTab, formatStamp, groupBySection, isStale,
  playersForSport, tabTotals, teamsForSport,
  type SeasonHealthReport, type SeasonTab, type Sport, type TabTotals,
} from './utils/seasonHealth'

const PILL = 'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold leading-4'
const PILL_ERROR = `${PILL} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400`
const PILL_WARN = `${PILL} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`

type LoadError = { message: string; status?: number }

const REGISTERS = [
  { key: 'vm_synced_at', label: 'register_vm' },
  { key: 'basketplan_scraped_at', label: 'register_basketplan' },
  { key: 'clubdesk_imported_at', label: 'register_clubdesk' },
  { key: 'finance_synced_at', label: 'register_finance' },
] as const

function TabPills({ totals }: { totals: TabTotals }) {
  const { t } = useTranslation('seasonHealth')
  if (totals.errors === 0 && totals.warnings === 0 && totals.failed === 0) return null
  return (
    <span className="ml-1 inline-flex items-center gap-1">
      {(totals.errors > 0 || totals.failed > 0) && (
        <span className={PILL_ERROR} title={t('errors', { count: totals.errors })}>
          {totals.errors + totals.failed}
        </span>
      )}
      {totals.warnings > 0 && (
        <span className={PILL_WARN} title={t('warnings', { count: totals.warnings })}>{totals.warnings}</span>
      )}
    </span>
  )
}

/** The finding sections of one tab (used by all three tabs). */
function FindingSections({ report, tab, showClean }: {
  report: SeasonHealthReport
  tab: SeasonTab
  showClean: boolean
}) {
  const { t } = useTranslation('seasonHealth')
  const groups = useMemo(
    () => groupBySection(checksForTab(report.checks ?? [], tab, showClean)),
    [report.checks, tab, showClean])
  if (groups.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4" role="status">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden="true" />
        <span className="text-sm text-green-700 dark:text-green-400">{t('allClean')}</span>
      </div>
    )
  }
  return (
    <>
      {groups.map((g) => (
        <FindingSection key={g.section} section={g.section} items={g.items} tab={tab} />
      ))}
    </>
  )
}

function SportPanel({ report, sport, showClean }: {
  report: SeasonHealthReport
  sport: Sport
  showClean: boolean
}) {
  const teams = useMemo(() => teamsForSport(report.teams ?? [], sport), [report.teams, sport])
  const players = useMemo(() => playersForSport(report.players ?? [], sport), [report.players, sport])
  const totals = useMemo(() => tabTotals(report.checks ?? [], sport), [report.checks, sport])
  return (
    <>
      <SeasonKpiTiles teams={teams} totals={totals} />
      <TeamSummaryTable teams={teams} />
      <PlayerStatusTable players={players} teams={teams} sport={sport} />
      <FindingSections report={report} tab={sport} showClean={showClean} />
    </>
  )
}

export default function SeasonHealthPage() {
  const { t } = useTranslation('seasonHealth')
  const [report, setReport] = useState<SeasonHealthReport | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<SeasonTab>('volleyball')
  const [showClean, setShowClean] = useState(false)

  // No state write before the first await: the mount effect below calls this
  // directly and react-hooks/set-state-in-effect would otherwise fire.
  async function fetchReport(refresh: boolean) {
    try {
      const r = await kscwApi<SeasonHealthReport>(`/admin/season-health${refresh ? '?refresh=1' : ''}`)
      setReport(r)
      setError(null)
    } catch (err) {
      const e = err as Error & { status?: number }
      setError({ message: e?.message || 'Failed to load', status: e?.status })
    } finally {
      setLoading(false)
    }
  }

  // Rescan / retry — event handlers, so the loading flip is fine here. The
  // content stays visible and dims; only the initial load holds the boot gate.
  function rescan() {
    setLoading(true)
    void fetchReport(true)
  }
  function retry() {
    setLoading(true)
    setError(null)
    void fetchReport(false)
  }

  useEffect(() => {
    async function run() { await fetchReport(false) }
    void run()
  }, [])

  const totalsByTab = useMemo(() => {
    const checks = report?.checks ?? []
    return Object.fromEntries(SEASON_TABS.map((s) => [s, tabTotals(checks, s)])) as Record<SeasonTab, TabTotals>
  }, [report])

  // Report to app boot gate — see usePageReady.tsx. Initial load only.
  const initial = !report && !error
  useReportPageLoading(initial)
  if (initial) return null

  const header = (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        {report && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('seasonLine', { season: report.season, time: formatTimeZurich(report.generated_at) })}
          </p>
        )}
      </div>
      <Button
        type="button" variant="outline" size="sm"
        onClick={rescan} disabled={loading} aria-busy={loading}
        className="min-h-11 gap-1.5 sm:min-h-0"
      >
        <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        {loading ? t('scanning') : t('rescan')}
      </Button>
    </div>
  )

  if (!report) {
    // error is set here. A 404 is the deploy window (frontend ships before the
    // backend) — a quiet notice, not an alarm.
    const notDeployed = error?.status === 404
    return (
      <div className="mx-auto max-w-6xl px-4 py-4">
        {header}
        <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-4 text-sm ${
          notDeployed
            ? 'border-border bg-muted/40 text-muted-foreground'
            : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
        }`} role="status">
          {!notDeployed && <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            {notDeployed ? t('notDeployed') : `${t('loadFailed')} (${error?.message ?? ''})`}
          </span>
          <button type="button" onClick={retry} className="min-h-11 underline hover:no-underline sm:min-h-0">
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  const registers = report.registers ?? {}

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      {header}

      {/* Register freshness — amber when a register is older than 8 days. */}
      <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium">{t('registers')}:</span>
        {REGISTERS.map(({ key, label }) => {
          const stamp = registers[key] ?? null
          const stale = isStale(stamp)
          return (
            <span
              key={key}
              className={stale ? 'text-amber-600 dark:text-amber-400' : ''}
              title={stale ? t('registerStale', { days: STALE_AFTER_DAYS }) : undefined}
            >
              {t(label)} {stamp ? formatStamp(stamp) : t('registerNever')}
            </span>
          )
        })}
      </p>

      {/* A rescan that failed keeps the last report on screen and says so. */}
      {error && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('loadFailed')} ({error.message})</span>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as SeasonTab)}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList className="mb-0 flex-wrap group-data-[orientation=horizontal]/tabs:h-auto">
            <TabsTrigger value="volleyball" className="min-h-11 sm:min-h-0">
              <VolleyballIcon className="h-4 w-4" />
              {t('tab_volleyball')}
              <TabPills totals={totalsByTab.volleyball} />
            </TabsTrigger>
            <TabsTrigger value="basketball" className="min-h-11 sm:min-h-0">
              <BasketballIcon className="h-4 w-4" />
              {t('tab_basketball')}
              <TabPills totals={totalsByTab.basketball} />
            </TabsTrigger>
            <TabsTrigger value="club" className="min-h-11 sm:min-h-0">
              {t('tab_club')}
              <TabPills totals={totalsByTab.club} />
            </TabsTrigger>
          </TabsList>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground sm:min-h-0">
            <Checkbox checked={showClean} onCheckedChange={(v) => setShowClean(v === true)} />
            {t('showClean')}
          </label>
        </div>

        <div className={`transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}>
          <TabsContent value="volleyball" className="space-y-4">
            <SportPanel report={report} sport="volleyball" showClean={showClean} />
          </TabsContent>
          <TabsContent value="basketball" className="space-y-4">
            <SportPanel report={report} sport="basketball" showClean={showClean} />
          </TabsContent>
          {/* Club-wide: club-grain checks + rows with no sport. No KPI/teams/players. */}
          <TabsContent value="club" className="space-y-4">
            <FindingSections report={report} tab="club" showClean={showClean} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
