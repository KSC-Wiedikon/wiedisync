import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { kscwApi } from '../../../lib/api'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'
import type { Team } from '../../../types'

interface SvrzStatus {
  total: number
  home: number
  away: number
  last_synced_at: string | null
}
import { useInvites } from '../hooks/useInvites'
import InviteRow from './InviteRow'
import InvitesDrawer from './InvitesDrawer'
import SendInvitesModal from './SendInvitesModal'

interface Props {
  teams: Team[]
  seasonId: string | number
  seasonName: string
}

export default function InvitesPanel({ teams, seasonId, seasonName }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [selectedTeamId, setSelectedTeamId] = useState<string | number | null>(teams[0]?.id ?? null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [svrz, setSvrz] = useState<SvrzStatus | null>(null)
  const selectedTeam = useMemo(() => teams.find((t) => String(t.id) === String(selectedTeamId)) ?? null, [teams, selectedTeamId])
  const api = useInvites(selectedTeamId, seasonId)
  // Invites that can still receive an email (not revoked/expired); booked/viewed
  // can be re-emailed as a reminder.
  const sendableIds = useMemo(
    () => api.invites.filter((i) => i.status !== 'revoked' && i.status !== 'expired').map((i) => i.id),
    [api.invites],
  )
  const frontendUrl = typeof window !== 'undefined' ? window.location.origin : 'https://wiedisync.kscw.ch'

  // Auto-create invite links for synced opponents the first time a team is shown,
  // so the list populates itself. Runs once per team+season (ref-guarded); the
  // backend dedupes by opponent name, so it's safe regardless of load order.
  const ensuredRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!selectedTeamId || !seasonId) return
    const key = `${selectedTeamId}:${seasonId}`
    if (ensuredRef.current.has(key)) return
    ensuredRef.current.add(key)
    api
      .ensureFromSvrz()
      .then((r) => { if (r && r.created > 0) toast.success(t('invitesAutoCreated', { count: r.created })) })
      .catch(() => { /* best-effort — admin can still add manually */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeamId, seasonId])

  const fetchSvrz = useCallback(async () => {
    try {
      const r = await kscwApi(`/admin/terminplanung/svrz-status?season_name=${encodeURIComponent(seasonName)}`) as SvrzStatus
      setSvrz(r)
    } catch { /* non-blocking summary */ }
  }, [seasonName])
  useEffect(() => { fetchSvrz() }, [fetchSvrz])

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      await kscwApi('/admin/terminplanung/svrz-sync', {
        method: 'POST',
        body: { season_name: seasonName },
      })
      // Also refresh VM team names/leagues (e.g. a junior team's Stärkeklasse
      // rename DU23-1 → DU23-2). Admin-only + best-effort: a non-admin spielplaner
      // gets 403 here, which we swallow so the SVRZ sync still counts as started.
      try {
        await kscwApi('/admin/vm-sync', { method: 'POST', body: {} })
      } catch { /* non-admin or VM busy — SVRZ already started */ }
      toast.success(t('svrzSyncStarted'))
      // The sync runs in the background; refresh the summary once it's likely done.
      setTimeout(fetchSvrz, 8000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>{t('invites')}</CardTitle>
          <Button size="sm" variant="outline" onClick={handleSyncNow} disabled={syncing}>
            {t('syncSvrzNow')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* SVRZ sync summary */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {svrz && svrz.total > 0 && svrz.last_synced_at
              ? t('svrzSynced', {
                  date: formatDateTimeCompact(svrz.last_synced_at),
                  total: svrz.total,
                  home: svrz.home,
                  away: svrz.away,
                })
              : t('svrzNotSynced')}
          </p>

          {/* Team selector */}
          <div className="flex flex-wrap gap-1">
            {teams.map((tm) => (
              <Button
                key={tm.id}
                size="sm"
                variant={String(tm.id) === String(selectedTeamId) ? 'default' : 'outline'}
                onClick={() => setSelectedTeamId(tm.id)}
              >
                {tm.name} <span className="ml-1 text-xs opacity-70">({tm.league || '—'})</span>
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words text-sm text-gray-600 dark:text-gray-400">
              {selectedTeam ? `${selectedTeam.name} (${selectedTeam.league || '—'})` : '—'} · {api.invites.length} {t('invites')}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setSendOpen(true)}
                disabled={!selectedTeam || sendableIds.length === 0}
              >
                {t('emailInvites')}
              </Button>
              <Button onClick={() => setDrawerOpen(true)} disabled={!selectedTeam}>
                {t('manageInvites')}
              </Button>
            </div>
          </div>

          {api.isLoading ? (
            <div className="py-6 text-center text-sm text-gray-500">Laden…</div>
          ) : api.invites.length === 0 ? (
            <div className="rounded border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-700">
              {t('noInvitesYet')}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {api.invites.map((inv) => (
                <InviteRow
                  key={inv.id}
                  invite={inv}
                  kscwTeam={{ name: selectedTeam?.name ?? '', league: selectedTeam?.league ?? '' }}
                  season={{ name: seasonName }}
                  frontendUrl={frontendUrl}
                  onReissue={api.reissue}
                  onRevoke={api.revoke}
                  onSent={api.markSent}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <InvitesDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        kscwTeam={selectedTeam ? { id: selectedTeam.id, name: selectedTeam.name, league: selectedTeam.league || '' } : null}
        api={api}
      />

      {selectedTeam && (
        <SendInvitesModal
          open={sendOpen}
          onOpenChange={setSendOpen}
          ids={sendableIds}
          ctx={{ seasonName, kscwTeamName: selectedTeam.name, kscwLeague: selectedTeam.league || '' }}
          api={api}
        />
      )}
    </>
  )
}
