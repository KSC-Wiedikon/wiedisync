import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CloudUpload, Eye, RefreshCw } from 'lucide-react'
import { kscwApi } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { useConfirm } from '../../components/ConfirmProvider'
import { useReportPageLoading } from '../../hooks/usePageReady'
import LoadingSpinner from '../../components/LoadingSpinner'
import TeamChip from '../../components/TeamChip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateTimeCompactZurich } from '../../utils/dateHelpers'

/**
 * VolleyManager rosters — put our volleyball players onto their VM team.
 *
 * The club must list, per VM team and season, the licensed players it may
 * nominate; VM only offers players whose licence is ACTIVATED, so the list
 * fills in waves. This page shows where every roster player stands (from the
 * Monday VM sync) and runs `POST /kscw/admin/vm-team-assign`, which diffs live
 * against VolleyManager and assigns whoever VM now offers. Add-only: nobody is
 * ever removed from a VM team from here.
 */

type PlanStatus = 'assignable' | 'licence_pending' | 'on_vm_team' | 'no_licence_nr' | 'unknown_to_vm' | 'no_vm_team'

interface PlanPlayer {
  memberId: number
  name: string
  licenseNr: string | null
  status: PlanStatus
  licenceActivated: boolean | null
  licenceValidated: boolean | null
}
interface PlanTeam {
  teamDbId: number
  teamName: string
  staticId: number | null
  hasVmTeam: boolean
  players: PlanPlayer[]
}
interface RunPlayer { memberId: number; licenseNr: string | null; name: string }
interface RunTeam {
  teamDbId: number
  teamName: string
  vmTeamName: string
  assigned: RunPlayer[]
  alreadyOnTeam: RunPlayer[]
  licencePending: RunPlayer[]
  noLicenceNr: RunPlayer[]
  extraOnVm: { licenseNr: string; name: string }[]
  vmPlayersBefore: number
  vmPlayersAfter: number | null
  error: string | null
}
interface RunResult {
  dryRun: boolean
  teams: RunTeam[]
  skipped: { teamName: string; reason: string }[]
  totals: { assigned: number; pending: number; already: number; noLicenceNr: number; extra: number; failed: number }
}
interface Run {
  status: 'running' | 'ok' | 'partial' | 'error'
  dryRun: boolean
  forcedDryRun: boolean
  startedAt: string
  finishedAt: string | null
  actor: string | null
  progress: { done: number; total: number; team: string }
  log: string[]
  error: string | null
  result: RunResult | null
}
interface PlanResponse {
  teams: PlanTeam[]
  totals: Record<PlanStatus, number>
  vmSyncedAt: string | null
  running: Run | null
  lastRun: Run | null
  vmConfigured: boolean
  forcedDryRun: boolean
  vmAccountHeldBy: string | null
}

const STATUS_BADGE: Record<PlanStatus, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  assignable: 'info',
  licence_pending: 'warning',
  on_vm_team: 'success',
  no_licence_nr: 'danger',
  unknown_to_vm: 'neutral',
  no_vm_team: 'neutral',
}
const OPEN_STATUSES: PlanStatus[] = ['assignable', 'licence_pending', 'no_licence_nr', 'unknown_to_vm']
const POLL_MS = 2500

export default function VmTeamRostersPage() {
  const { t } = useTranslation('admin')
  const { user, hasAdminAccessToSport } = useAuth()
  const canVb = hasAdminAccessToSport('volleyball')
  const confirm = useConfirm()

  const [data, setData] = useState<PlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [openOnly, setOpenOnly] = useState(true)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await kscwApi<PlanResponse>('/admin/vm-team-assign')
      setData(r)
    } catch {
      toast.error(t('vmtLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // Effect-local async wrapper — `load` only setStates after the await, so the
  // effect body itself performs no synchronous state update (react-hooks
  // set-state-in-effect; same shape as ClubPortalsPanel).
  useEffect(() => {
    if (!user || !canVb) return
    async function run() { await load() }
    void run()
  }, [user, canVb, load])
  useReportPageLoading(loading)

  // Poll while a run is in flight — the POST returns 202 and the run reports
  // through the GET.
  const running = !!data?.running
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(id)
  }, [running, load])

  // After a run the live result is the truth; overlay it on the Monday-sync
  // plan so the table does not contradict the panel above it.
  const liveStatus = useMemo(() => {
    const live = new Map<string, PlanStatus>()
    const res = data?.lastRun?.result
    if (!res || data?.lastRun?.status === 'error') return live
    for (const rt of res.teams) {
      const key = (p: RunPlayer) => `${rt.teamDbId}:${p.memberId}`
      for (const p of rt.assigned) live.set(key(p), res.dryRun ? 'assignable' : 'on_vm_team')
      for (const p of rt.alreadyOnTeam) live.set(key(p), 'on_vm_team')
      for (const p of rt.licencePending) live.set(key(p), 'licence_pending')
      for (const p of rt.noLicenceNr) live.set(key(p), 'no_licence_nr')
    }
    return live
  }, [data])

  const allRows = useMemo(() => {
    const out: { team: PlanTeam; player: PlanPlayer }[] = []
    for (const team of data?.teams ?? []) {
      for (const player of team.players) {
        const status = liveStatus.get(`${team.teamDbId}:${player.memberId}`) ?? player.status
        out.push({ team, player: { ...player, status } })
      }
    }
    return out
  }, [data, liveStatus])

  const rows = useMemo(
    () => (openOnly ? allRows.filter((r) => OPEN_STATUSES.includes(r.player.status)) : allRows),
    [allRows, openOnly],
  )

  const totals = useMemo(() => {
    const c: Record<PlanStatus, number> = { assignable: 0, licence_pending: 0, on_vm_team: 0, no_licence_nr: 0, unknown_to_vm: 0, no_vm_team: 0 }
    for (const r of allRows) c[r.player.status]++
    return c
  }, [allRows])

  const start = async (dryRun: boolean) => {
    if (!data) return
    if (!dryRun && !data.forcedDryRun) {
      const ok = await confirm({
        title: t('vmtRun'),
        message: t('vmtRunConfirm', { count: totals.assignable }),
        confirmLabel: t('vmtRun'),
      })
      if (!ok) return
    }
    setStarting(true)
    try {
      const r = await kscwApi<{ started: boolean; dryRun: boolean }>('/admin/vm-team-assign', {
        method: 'POST', body: { dry_run: dryRun },
      })
      toast.success(r.dryRun ? t('vmtStartedDry') : t('vmtStarted'))
      await load()
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === 'vm_account_busy') toast.error(t('vmtBusy'))
      else if (code === 'run_in_flight') toast.error(t('vmtInFlight'))
      else toast.error(t('vmtStartFailed'))
    } finally {
      setStarting(false)
    }
  }

  if (!canVb) return <Navigate to="/" replace />

  const run = data?.running ?? data?.lastRun ?? null
  const busy = running || starting

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('vmtTitle')}</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('vmtSubtitle')}</p>

      {loading || !data ? (
        <div className="py-12"><LoadingSpinner /></div>
      ) : (
        <>
          {/* ── Actions ─────────────────────────────────────────────── */}
          <div className="mt-5 rounded-lg border bg-card p-4 dark:border-gray-700">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {data.vmSyncedAt
                  ? t('vmtPlanBasis', { date: formatDateTimeCompactZurich(data.vmSyncedAt) })
                  : t('vmtPlanBasisNoSync')}
                {data.vmAccountHeldBy && !running && (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">{t('vmtHeld', { holder: data.vmAccountHeldBy })}</span>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => start(true)} disabled={busy || !data.vmConfigured} loading={starting} icon={<Eye />}>
                  {t('vmtPreview')}
                </Button>
                <Button onClick={() => start(false)} disabled={busy || !data.vmConfigured || data.forcedDryRun} loading={starting} icon={<CloudUpload />}>
                  {t('vmtRun')}
                </Button>
              </div>
            </div>
            {!data.vmConfigured && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{t('vmtVmUnconfigured')}</p>
            )}
            {data.forcedDryRun && (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{t('vmtDevDry')}</p>
            )}
            {running && data.running && (
              <p className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                {t('vmtRunning', { done: data.running.progress.done, total: data.running.progress.total, team: data.running.progress.team })}
              </p>
            )}
          </div>

          {/* ── Last run ────────────────────────────────────────────── */}
          {run && run.status !== 'running' && (
            <div className="mt-4 rounded-lg border bg-card p-4 dark:border-gray-700">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {run.dryRun ? t('vmtLastPreview') : t('vmtLastRun')}
                  <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                    {formatDateTimeCompactZurich(run.finishedAt ?? run.startedAt)}
                    {run.actor ? ` · ${t('vmtBy', { name: run.actor })}` : ''}
                  </span>
                </h2>
                <Badge variant={run.status === 'ok' ? 'success' : run.status === 'partial' ? 'warning' : 'danger'}>
                  {t(`vmtRunStatus_${run.status}`)}
                </Badge>
              </div>
              {run.error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t('vmtError', { error: run.error })}</p>}
              {run.result && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Badge variant="info">{run.result.dryRun ? t('vmtResultWouldAssign') : t('vmtResultAssigned')}: {run.result.totals.assigned}</Badge>
                    <Badge variant="warning">{t('vmtResultPending')}: {run.result.totals.pending}</Badge>
                    <Badge variant="success">{t('vmtResultAlready')}: {run.result.totals.already}</Badge>
                    {run.result.totals.failed > 0 && <Badge variant="danger">{t('vmtResultFailed')}: {run.result.totals.failed}</Badge>}
                  </div>
                  <div className="mt-3 overflow-x-auto rounded-lg border dark:border-gray-700">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('vmtColTeam')}</TableHead>
                          <TableHead>{run.result.dryRun ? t('vmtResultWouldAssign') : t('vmtResultAssigned')}</TableHead>
                          <TableHead>{t('vmtResultPending')}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t('vmtResultExtra')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {run.result.teams.map((rt) => (
                          <TableRow key={rt.teamDbId} className={rt.error ? 'bg-red-50 dark:bg-red-900/10' : ''}>
                            <TableCell className="align-top">
                              <div className="flex flex-col items-start gap-0.5">
                                <TeamChip team={rt.teamName} size="sm" />
                                {/* VM player count before → after the write (before only on a preview). */}
                                <span className="whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400">
                                  {rt.vmPlayersAfter != null ? `${rt.vmPlayersBefore} → ${rt.vmPlayersAfter}` : rt.vmPlayersBefore}
                                </span>
                              </div>
                              {rt.error && <p className="mt-1 whitespace-normal text-xs text-red-600 dark:text-red-400">{rt.error}</p>}
                            </TableCell>
                            <TableCell className="whitespace-normal align-top text-sm">
                              {rt.assigned.length ? rt.assigned.map((p) => p.name).join(', ') : <span className="text-gray-400">—</span>}
                            </TableCell>
                            <TableCell className="whitespace-normal align-top text-sm">
                              {rt.licencePending.length ? rt.licencePending.map((p) => p.name).join(', ') : <span className="text-gray-400">—</span>}
                            </TableCell>
                            <TableCell className="hidden whitespace-normal align-top text-sm sm:table-cell">
                              {rt.extraOnVm.length ? rt.extraOnVm.map((p) => `${p.name} (${p.licenseNr})`).join(', ') : <span className="text-gray-400">—</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                        {run.result.skipped.map((s) => (
                          <TableRow key={`skip-${s.teamName}`}>
                            <TableCell><TeamChip team={s.teamName} size="sm" /></TableCell>
                            <TableCell colSpan={3} className="text-sm text-gray-500 dark:text-gray-400">{t('vmtNoVmTeam')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
              {run.log.length > 0 && (
                <div className="mt-3">
                  <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setShowLog((v) => !v)}>
                    {showLog ? t('vmtHideLog') : t('vmtShowLog')}
                  </button>
                  {showLog && (
                    <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-gray-100 p-3 text-[11px] leading-snug text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                      {run.log.join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Plan table ──────────────────────────────────────────── */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-xs">
              {(Object.keys(totals) as PlanStatus[]).filter((s) => totals[s] > 0).map((s) => (
                <Badge key={s} variant={STATUS_BADGE[s]}>{t(`vmtStatus_${s}`)}: {totals[s]}</Badge>
              ))}
            </div>
            <div className="flex gap-1">
              <Button variant={openOnly ? 'default' : 'outline'} size="sm" onClick={() => setOpenOnly(true)}>{t('vmtFilterOpen')}</Button>
              <Button variant={!openOnly ? 'default' : 'outline'} size="sm" onClick={() => setOpenOnly(false)}>{t('vmtFilterAll')}</Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {openOnly ? t('vmtNothingOpen') : t('vmtEmpty')}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border bg-card dark:border-gray-700">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('vmtColTeam')}</TableHead>
                    <TableHead>{t('vmtColPlayer')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('vmtColLicence')}</TableHead>
                    <TableHead>{t('vmtColStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ team, player }) => (
                    <TableRow key={`${team.teamDbId}:${player.memberId}`} className="min-h-11">
                      <TableCell className="align-top"><TeamChip team={team.teamName} size="sm" /></TableCell>
                      <TableCell className="whitespace-normal align-top leading-tight">
                        {player.name}
                        <span className="block text-xs text-gray-400 sm:hidden">{player.licenseNr ?? '—'}</span>
                      </TableCell>
                      <TableCell className="hidden align-top tabular-nums sm:table-cell">{player.licenseNr ?? <span className="text-gray-400">—</span>}</TableCell>
                      <TableCell className="align-top">
                        <Badge
                          variant={STATUS_BADGE[player.status]}
                          className="whitespace-nowrap"
                          title={`${t(`vmtStatus_${player.status}`)}${player.licenceActivated != null ? ` · ${t('vmtActivated')}: ${player.licenceActivated ? '✓' : '✗'} · ${t('vmtValidated')}: ${player.licenceValidated ? '✓' : '✗'}` : ''}`}
                        >
                          {t(`vmtShort_${player.status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
