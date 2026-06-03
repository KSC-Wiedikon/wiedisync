import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfraHealth } from '../../hooks/useInfraHealth'
import { API_URL, fetchItems, countItems, getAccessToken } from '../../lib/api'
import { currentLocale } from '../../utils/dateHelpers'

const PROD_URL = API_URL
const DEV_URL = 'https://directus-dev.kscw.ch'
const PUSH_WORKER_URL = 'https://kscw-push.lucanepa.workers.dev'

type Status = 'healthy' | 'down' | 'stale' | 'checking' | 'unknown'

interface HealthCheck {
  name: string
  status: Status
  detail: string
  responseTime?: number | null
  value?: string | number | null
  /** When set, the card renders a "Run now" button that triggers this scraper. */
  onRefresh?: () => void
  refreshing?: boolean
}

// Manually-triggerable data sources → their /kscw/admin/<endpoint> route.
// SV / BP / GCal run in-process (fast); VM / SVRZ spawn a child and return 202.
const SYNC_SOURCES: { key: string; labelKey: string; endpoint: string }[] = [
  { key: 'sv_sync', labelKey: 'infraSvSync', endpoint: 'sv-sync' },
  { key: 'bp_sync', labelKey: 'infraBpSync', endpoint: 'bp-sync' },
  { key: 'vm_sync', labelKey: 'infraVmSync', endpoint: 'vm-sync' },
  { key: 'svrz_sync', labelKey: 'infraSvrzSync', endpoint: 'svrz-sync' },
  { key: 'gcal_sync', labelKey: 'infraGcalSync', endpoint: 'gcal-sync' },
]

function statusColor(s: Status) {
  switch (s) {
    case 'healthy': return { dot: 'bg-green-500', badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', glow: 'shadow-green-500/40' }
    case 'down': return { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', glow: 'shadow-red-500/40' }
    case 'stale': return { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', glow: 'shadow-amber-500/40' }
    case 'checking': return { dot: 'bg-gray-400 animate-pulse', badge: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', glow: '' }
    default: return { dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', glow: '' }
  }
}

function timeAgo(dateStr: string, t: (k: string) => string): string {
  if (!dateStr) return t('infraNever')
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return `< 1 ${t('infraMin')} ${t('infraAgo')}`
  if (mins < 60) return `${mins} ${t('infraMin')} ${t('infraAgo')}`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${t('infraAgo')}`
  const days = Math.floor(hrs / 24)
  return `${days}d ${t('infraAgo')}`
}

async function checkEndpoint(url: string, noCorsOk = false): Promise<{ ok: boolean; ms: number; status: number; cors: boolean }> {
  const start = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' })
    return { ok: res.ok, ms: Date.now() - start, status: res.status, cors: false }
  } catch {
    if (noCorsOk) {
      // Retry with no-cors — opaque response means server is reachable
      try {
        const res = await fetch(url, { method: 'GET', mode: 'no-cors' })
        return { ok: res.type === 'opaque', ms: Date.now() - start, status: 0, cors: false }
      } catch {
        return { ok: false, ms: Date.now() - start, status: 0, cors: true }
      }
    }
    return { ok: false, ms: Date.now() - start, status: 0, cors: true }
  }
}

function Card({ check }: { check: HealthCheck }) {
  const { t } = useTranslation('admin')
  const c = statusColor(check.status)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="mb-2 flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${c.dot} ${c.glow ? `shadow-[0_0_6px]` : ''} ${c.glow}`} />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{check.name}</span>
      </div>
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${c.badge}`}>
        {t(`infra_${check.status}`)}
      </span>
      {check.detail && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{check.detail}</p>
      )}
      {check.value != null && (
        <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{check.value}</p>
      )}
      {check.responseTime != null && (
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          {t('infraResponseTime')}: {check.responseTime}ms
        </p>
      )}
      {check.onRefresh && (
        <button
          onClick={check.onRefresh}
          disabled={check.refreshing}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          {check.refreshing ? (
            <>
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {t('infraChecking')}
            </>
          ) : t('infraRunNow')}
        </button>
      )}
    </div>
  )
}

function Section({ title, checks }: { title: string; checks: HealthCheck[] }) {
  if (!checks.length) return null
  return (
    <div className="mb-6">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {checks.map((c) => <Card key={c.name} check={c} />)}
      </div>
    </div>
  )
}

export default function InfraHealthPage() {
  const { t } = useTranslation('admin')
  const infraHealth = useInfraHealth()
  const infraRef = useRef(infraHealth)
  infraRef.current = infraHealth

  const [services, setServices] = useState<HealthCheck[]>([])
  const [syncs, setSyncs] = useState<HealthCheck[]>([])
  const [crons, setCrons] = useState<HealthCheck[]>([])
  const [stats, setStats] = useState<HealthCheck[]>([])
  const [vps, setVps] = useState<HealthCheck[]>([])
  const [slowQueries, setSlowQueries] = useState<{ avg_ms: number; max_ms: number; calls: number; total_ms: number; rows: number; query: string }[]>([])
  const [lastCheck, setLastCheck] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [triggering, setTriggering] = useState<Record<string, boolean>>({})

  // Trigger a scraper, then poll sync_runs until its heartbeat advances past
  // the click (capped). VM / SVRZ are long-running (return 202 immediately);
  // the poll cap just stops the spinner — the heartbeat reflects completion
  // on the next manual refresh regardless.
  const triggerSync = useCallback(async (source: string, endpoint: string) => {
    setTriggering(prev => ({ ...prev, [source]: true }))
    const clickedAt = Date.now()
    const token = getAccessToken()
    const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined
    try {
      await fetch(`${PROD_URL}/kscw/admin/${endpoint}`, { method: 'POST', headers: authHeader })
    } catch { /* poll reflects the outcome */ }

    let polls = 0
    const MAX_POLLS = 12 // ~100s
    const poll = async () => {
      polls++
      let advanced = false
      try {
        const r = await fetch(`${PROD_URL}/kscw/admin/sync-status`, { headers: authHeader })
        if (r.ok) {
          const { runs } = await r.json()
          const run = (runs || []).find((x: { source: string }) => x.source === source) as { last_run_at?: string } | undefined
          advanced = !!run?.last_run_at && new Date(run.last_run_at).getTime() > clickedAt - 5000
        }
      } catch { /* keep polling */ }
      if (advanced || polls >= MAX_POLLS) {
        setTriggering(prev => ({ ...prev, [source]: false }))
        infraRef.current.refresh()
      } else {
        setTimeout(poll, 8000)
      }
    }
    setTimeout(poll, 8000)
  }, [])

  // Map sync_runs heartbeats → one triggerable card per scraper.
  useEffect(() => {
    const byKey = new Map(infraHealth.runs.map(r => [r.source, r]))
    const SYNC_STALE = 48 * 3600000
    setSyncs(SYNC_SOURCES.map(src => {
      const run = byKey.get(src.key)
      const ranAt = run?.last_run_at && new Date(run.last_run_at).getTime() > new Date('2000-01-01').getTime()
        ? run.last_run_at : null
      let status: Status = 'unknown'
      let detail = t('infraNoData')
      if (ranAt) {
        const ageMs = (run!.age_seconds ?? 0) * 1000
        status = run!.status === 'error' ? 'down' : ageMs > SYNC_STALE ? 'stale' : 'healthy'
        detail = run!.status === 'error'
          ? (run!.error_message?.slice(0, 60) || timeAgo(ranAt, t))
          : timeAgo(ranAt, t)
      }
      return {
        name: t(src.labelKey),
        status,
        detail,
        onRefresh: () => triggerSync(src.key, src.endpoint),
        refreshing: !!triggering[src.key],
      }
    }))
  }, [infraHealth.runs, triggering, t, triggerSync])

  const runChecks = useCallback(async () => {
    setLoading(true)

    // ── Services ──
    const svcResults: HealthCheck[] = []

    // API Prod (no-cors fallback — same treatment as Dev; avoids racing the
    // shared hook's useEffect, which populated undefined on first render and
    // made the Prod card flash "Down" even when reachable)
    const prodHealth = await checkEndpoint(`${PROD_URL}/server/health`, true)
    const apiProdOk = prodHealth.ok
    svcResults.push({
      name: t('infraPbProd'),
      status: apiProdOk ? 'healthy' : prodHealth.cors ? 'unknown' : 'down',
      detail: apiProdOk
        ? PROD_URL.replace('https://', '')
        : prodHealth.cors ? 'CORS (cross-origin)' : 'Unreachable',
      responseTime: apiProdOk ? prodHealth.ms : null,
    })

    // API Dev (no-cors fallback — dev server may not whitelist this origin)
    const devHealth = await checkEndpoint(`${DEV_URL}/server/health`, true)
    svcResults.push({
      name: t('infraPbDev'),
      status: devHealth.ok ? 'healthy' : devHealth.cors ? 'unknown' : 'down',
      detail: devHealth.ok ? DEV_URL.replace('https://', '') : devHealth.cors ? 'CORS (cross-origin)' : `HTTP ${devHealth.status}`,
      responseTime: devHealth.ok ? devHealth.ms : null,
    })

    // Cloudflare Tunnel (implied by API Prod reachability)
    svcResults.push({
      name: t('infraCfTunnel'),
      status: apiProdOk ? 'healthy' : 'down',
      detail: apiProdOk ? 'kscw-vps tunnel active' : 'Tunnel unreachable',
    })

    // Push Worker (no CORS headers — use no-cors fallback, opaque = reachable)
    const push = await checkEndpoint(`${PUSH_WORKER_URL}/health`, true)
    svcResults.push({
      name: t('infraPushWorker'),
      status: push.ok ? 'healthy' : 'down',
      detail: push.ok ? PUSH_WORKER_URL.replace('https://', '') : 'Unreachable',
      responseTime: push.ok ? push.ms : null,
    })

    // Directus extensions deployed (check a known KSCW endpoint)
    const hooks = await checkEndpoint(`${PROD_URL}/kscw/web-push/vapid-public-key`)
    svcResults.push({
      name: t('infraHooksDeployed'),
      status: hooks.ok ? 'healthy' : 'down',
      detail: hooks.ok ? 'KSCW extensions active' : 'Extensions not responding',
      responseTime: hooks.ms,
    })

    // Postgres DB (check via Directus — if items query works, DB is alive)
    const dbStart = Date.now()
    try {
      await fetchItems('teams', { limit: 1, fields: ['id'] })
      svcResults.push({
        name: t('infraPostgres'),
        status: 'healthy',
        detail: 'coolify-db',
        responseTime: Date.now() - dbStart,
      })
    } catch {
      svcResults.push({ name: t('infraPostgres'), status: 'down', detail: 'Query failed' })
    }

    // Error Log — today's error count
    try {
      const token = getAccessToken()
      const res = await fetch(`${PROD_URL}/kscw/admin/error-logs?limit=1`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        const total = data.total ?? 0
        svcResults.push({
          name: t('infraErrorLog'),
          status: total === 0 ? 'healthy' : total <= 10 ? 'healthy' : total <= 50 ? 'stale' : 'down',
          detail: total === 0 ? t('infraNoErrors') : `${total} ${t('infraErrorsToday')}`,
          value: total,
        })
      }
    } catch {
      svcResults.push({ name: t('infraErrorLog'), status: 'unknown', detail: '' })
    }

    // CF Pages — wiedisync (check if frontend is reachable)
    const cfWiedisync = await checkEndpoint('https://wiedisync.kscw.ch/', true)
    svcResults.push({
      name: 'CF Pages (WiediSync)',
      status: cfWiedisync.ok ? 'healthy' : 'down',
      detail: cfWiedisync.ok ? 'wiedisync.kscw.ch' : 'Unreachable',
      responseTime: cfWiedisync.ok ? cfWiedisync.ms : null,
    })

    // CF Pages — kscw-website
    const cfWebsite = await checkEndpoint('https://kscw-website.pages.dev/', true)
    svcResults.push({
      name: 'CF Pages (Website)',
      status: cfWebsite.ok ? 'healthy' : 'down',
      detail: cfWebsite.ok ? 'kscw-website.pages.dev' : 'Unreachable',
      responseTime: cfWebsite.ok ? cfWebsite.ms : null,
    })

    setServices(svcResults)

    // Trigger shared hook refresh (updates syncs via useEffect above)
    infraRef.current.refresh()

    // ── Cron Jobs ──
    const cronResults: HealthCheck[] = []
    const CRON_STALE = 48 * 3600000 // 48h

    // Notifications (created by Postgres triggers on game/training/event CRUD)
    try {
      const notif = await fetchItems<{ date_created: string }>('notifications', {
        limit: 1,
        sort: ['-date_created'],
        fields: ['date_created'],
      })
      if (notif.length) {
        const last = notif[0].date_created
        const diff = Date.now() - new Date(last).getTime()
        cronResults.push({
          name: t('infraNotifCron'),
          status: diff > CRON_STALE ? 'stale' : 'healthy',
          detail: timeAgo(last, t),
        })
      } else {
        cronResults.push({ name: t('infraNotifCron'), status: 'unknown', detail: t('infraNoData') })
      }
    } catch {
      cronResults.push({ name: t('infraNotifCron'), status: 'unknown', detail: '' })
    }

    // Participation Reminders (deadline_reminder notifications from 07:00 UTC cron)
    try {
      const reminders = await fetchItems<{ date_created: string }>('notifications', {
        limit: 1,
        sort: ['-date_created'],
        filter: { type: { _eq: 'deadline_reminder' } },
        fields: ['date_created'],
      })
      if (reminders.length) {
        const last = reminders[0].date_created
        const diff = Date.now() - new Date(last).getTime()
        cronResults.push({
          name: t('infraParticipationCron'),
          status: diff > CRON_STALE ? 'stale' : 'healthy',
          detail: timeAgo(last, t),
        })
      } else {
        cronResults.push({ name: t('infraParticipationCron'), status: 'unknown', detail: t('infraNoData') })
      }
    } catch {
      cronResults.push({ name: t('infraParticipationCron'), status: 'unknown', detail: '' })
    }

    // Upcoming Activity Reminders (06:30 UTC cron)
    try {
      const upcoming = await fetchItems<{ date_created: string }>('notifications', {
        limit: 1,
        sort: ['-date_created'],
        filter: { type: { _eq: 'upcoming_activity' } },
        fields: ['date_created'],
      })
      if (upcoming.length) {
        const last = upcoming[0].date_created
        const diff = Date.now() - new Date(last).getTime()
        cronResults.push({
          name: t('infraUpcomingCron'),
          status: diff > CRON_STALE ? 'stale' : 'healthy',
          detail: timeAgo(last, t),
        })
      } else {
        cronResults.push({ name: t('infraUpcomingCron'), status: 'unknown', detail: t('infraNoData') })
      }
    } catch {
      cronResults.push({ name: t('infraUpcomingCron'), status: 'unknown', detail: '' })
    }

    // Shell Expiry (02:00 UTC — check if any expired shells remain active)
    try {
      const expired = await countItems('members', {
        shell: { _eq: true },
        kscw_membership_active: { _eq: true },
        shell_expires: { _lt: new Date().toISOString() },
      })
      cronResults.push({
        name: t('infraShellExpiry'),
        status: expired === 0 ? 'healthy' : 'stale',
        detail: expired === 0 ? t('infraAllCleaned') : `${expired} ${t('infraExpiredRemain')}`,
      })
    } catch {
      cronResults.push({ name: t('infraShellExpiry'), status: 'unknown', detail: '' })
    }

    // Push Delivery (check last push subscription activity)
    try {
      const subs = await countItems('push_subscriptions')
      cronResults.push({
        name: t('infraPushDelivery'),
        status: subs > 0 ? 'healthy' : 'stale',
        detail: `${subs} ${t('infraActiveSubs')}`,
        value: subs,
      })
    } catch {
      cronResults.push({ name: t('infraPushDelivery'), status: 'unknown', detail: '' })
    }

    setCrons(cronResults)

    // ── Stats ──
    const statResults: HealthCheck[] = []

    try {
      const [members, teams, games] = await Promise.all([
        countItems('members', { kscw_membership_active: { _eq: true } }),
        countItems('teams', { active: { _eq: true } }),
        countItems('games'),
      ])
      statResults.push(
        { name: t('infraActiveMembers'), status: 'healthy', detail: '', value: members },
        { name: t('infraActiveTeams'), status: 'healthy', detail: '', value: teams },
        { name: t('infraTotalGames'), status: 'healthy', detail: '', value: games },
      )
    } catch { /* skip stats on error */ }

    // Migration tracker — applied vs pending. Pending > 0 means dev/prod
    // are out of sync; the deploy hasn't been run yet.
    try {
      const token = getAccessToken()
      const r = await fetch(`${PROD_URL}/kscw/admin/migrations-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (r.ok) {
        const m = await r.json()
        const pendingCount = Array.isArray(m.pending) ? m.pending.length : 0
        statResults.push({
          name: 'Migrations applied',
          status: pendingCount === 0 ? 'healthy' : 'stale',
          detail: pendingCount === 0
            ? `Latest: ${m.latest ?? '—'}`
            : `${pendingCount} pending: ${(m.pending ?? []).slice(0, 3).join(', ')}${pendingCount > 3 ? '…' : ''}`,
          value: m.applied,
        })
      }
    } catch { /* skip migration check on error */ }

    setStats(statResults)

    // ── VPS Metrics ──
    const vpsResults: HealthCheck[] = []
    try {
      const token = getAccessToken()
      const vpsRes = await fetch(`${PROD_URL}/kscw/admin/vps-metrics`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (vpsRes.ok) {
        const v = await vpsRes.json()
        vpsResults.push(
          { name: 'Uptime', status: 'healthy', detail: v.uptime, value: null },
          { name: 'CPU Load', status: parseFloat(v.loadavg) > v.cpu_count * 0.8 ? 'stale' : 'healthy', detail: `${v.loadavg} (${v.cpu_count} cores)`, value: null },
          { name: 'Memory', status: v.memory.percent > 90 ? 'down' : v.memory.percent > 75 ? 'stale' : 'healthy', detail: `${v.memory.used} / ${v.memory.total}`, value: `${v.memory.percent}%` },
          { name: 'Disk', status: v.disk.percent > 90 ? 'down' : v.disk.percent > 75 ? 'stale' : 'healthy', detail: `${v.disk.used} / ${v.disk.total}`, value: `${v.disk.percent}%` },
        )
      }
    } catch { /* skip VPS metrics on error */ }
    setVps(vpsResults)

    // ── Slow Queries ──
    try {
      const token = getAccessToken()
      const sqRes = await fetch(`${PROD_URL}/kscw/admin/slow-queries?limit=10`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (sqRes.ok) {
        const sqData = await sqRes.json()
        setSlowQueries((sqData.data || []).map((q: Record<string, string>) => ({
          avg_ms: parseFloat(q.avg_ms),
          max_ms: parseFloat(q.max_ms),
          calls: parseInt(q.calls),
          total_ms: parseFloat(q.total_ms),
          rows: parseInt(q.rows),
          query: q.query,
        })))
      }
    } catch { /* skip slow queries on error */ }

    setLastCheck(new Date().toLocaleTimeString(currentLocale(), { hour12: false }))
    setLoading(false)
  }, [t])

  // Run once on mount — no deps to avoid re-trigger loop
  useEffect(() => { runChecks() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('infraTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('infraDescription')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastCheck && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {lastCheck}
            </span>
          )}
          <button
            onClick={runChecks}
            disabled={loading}
            className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('infraChecking')}
              </span>
            ) : t('infraRefresh')}
          </button>
        </div>
      </div>

      {vps.length > 0 && <Section title="VPS Resources" checks={vps} />}
      <Section title={t('infraServices')} checks={services} />
      <Section title={t('infraDataSyncs')} checks={syncs} />
      <Section title={t('infraCronJobs')} checks={crons} />
      {stats.length > 0 && <Section title={t('infraStats')} checks={stats} />}

      {slowQueries.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('infraSlowQueries')}
          </h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">{t('infraQueryAvg')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">{t('infraQueryMax')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">{t('infraQueryCalls')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">{t('infraQueryTotal')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Query</th>
                </tr>
              </thead>
              <tbody>
                {slowQueries.map((q, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0 dark:border-gray-700/50">
                    <td className={`px-3 py-2 font-mono tabular-nums ${q.avg_ms > 100 ? 'font-bold text-red-600 dark:text-red-400' : q.avg_ms > 20 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}`}>
                      {q.avg_ms}ms
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-gray-600 dark:text-gray-400">{q.max_ms}ms</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-gray-600 dark:text-gray-400">{q.calls.toLocaleString(currentLocale())}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-gray-600 dark:text-gray-400">{q.total_ms > 1000 ? `${(q.total_ms / 1000).toFixed(1)}s` : `${q.total_ms}ms`}</td>
                    <td className="max-w-xs truncate px-3 py-2 font-mono text-gray-500 dark:text-gray-400" title={q.query}>
                      {q.query}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
