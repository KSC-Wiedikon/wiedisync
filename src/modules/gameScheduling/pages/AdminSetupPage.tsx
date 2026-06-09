import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../../hooks/useAuth'
import { kscwApi } from '../../../lib/api'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useAdminBookings } from '../hooks/useAdminBookings'
import { useTeams } from '../../../hooks/useTeams'
import LoadingSpinner from '../../../components/LoadingSpinner'
import SeasonConfig from '../components/SeasonConfig'
import { previousSeasonShort } from '../utils/formatSeason'
import { isSchedulableTeam } from '../utils/schedulableTeams'
import SpielsamstageEditor from '../components/SpielsamstageEditor'
import SlotGenerationPanel from '../components/SlotGenerationPanel'
import TeamSlotConfigPanel from '../components/TeamSlotConfigPanel'
import GapConfigPanel from '../components/GapConfigPanel'
import DerbyPanel from '../components/DerbyPanel'
import ExcelImportPanel from '../components/ExcelImportPanel'
import InvitesPanel from '../components/InvitesPanel'
import type { SpielsamstagConfig, TeamSlotConfig, GameSchedulingGapConfig } from '../../../types'

interface RolloverResult {
  from_season: string
  to_season: string
  teams_cloned: number
  member_teams: number
  teams_archived: number
}

export default function AdminSetupPage() {
  const { t } = useTranslation('gameScheduling')
  const { hasAdminAccessToSport, isGlobalAdmin, is_spielplaner } = useAuth()
  const { season, allSeasons, isLoading, createSeason, updateSeason, setSeason, refetch: refetchSeasons } = useGameSchedulingSeason()
  const { generateSlots, slots } = useAdminBookings(season?.id)
  const { data: teams, refetch: refetchTeams } = useTeams()
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<{ total_created: number } | null>(null)

  if (!hasAdminAccessToSport('volleyball') && !is_spielplaner) {
    return <Navigate to="/" replace />
  }

  // Only blank to a spinner on the very first load. Mutations (toggles,
  // Spielsamstage save, status changes) refetch the season and flip isLoading
  // back to true — without the `!season` guard that re-rendered the whole page
  // to a spinner on every click, which read as a full page reload.
  if (isLoading && !season) return <LoadingSpinner />

  const handleCreateSeason = async (name: string) => {
    await createSeason(name)
  }

  const handleUpdateSpielsamstage = async (spielsamstage: SpielsamstagConfig[]) => {
    if (!season) return
    await updateSeason(season.id, { spielsamstage } as Record<string, unknown>)
  }

  const handleUpdateTeamConfig = async (config: TeamSlotConfig) => {
    if (!season) return
    await updateSeason(season.id, { team_slot_config: config } as Record<string, unknown>)
  }

  const handleUpdateGapConfig = async (cfg: GameSchedulingGapConfig) => {
    if (!season) return
    await updateSeason(season.id, { gap_config: cfg } as Record<string, unknown>)
  }

  const handleStatusChange = async (status: 'setup' | 'open' | 'closed') => {
    if (!season) return
    await updateSeason(season.id, { status } as Record<string, unknown>)
    // When opening a season for booking, kick off an SVRZ sync in the
    // background so games + contacts for the current season land in Directus
    // without the admin having to click a second button. The sync runs
    // detached server-side (~9 min) and is idempotent.
    if (status === 'open') {
      try {
        await kscwApi('/admin/terminplanung/svrz-sync', { method: 'POST', body: {} })
        toast.success(t('svrzSyncStarted'))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
  }

  // Club-wide season rollover: deep-clone the previous season's teams + rosters +
  // staff + sponsors + hall slots into the selected season, then archive the old one.
  // Dry-run first to show real counts in the confirm dialog.
  const handleRollover = async () => {
    if (!season?.season) return
    const from = previousSeasonShort(season.season)
    if (!from) {
      toast.error(t('rolloverNoPrev'))
      return
    }
    try {
      const preview = await kscwApi<RolloverResult>('/admin/terminplanung/rollover-season', {
        method: 'POST',
        body: { from_season: from, to_season: season.season, dry_run: true },
      })
      if (preview.teams_cloned === 0) {
        toast.error(t('rolloverEmptySource', { from }))
        return
      }
      if (!window.confirm(t('rolloverConfirm', { from, to: season.season, teams: preview.teams_cloned, members: preview.member_teams }))) return
      const resp = await kscwApi<RolloverResult>('/admin/terminplanung/rollover-season', {
        method: 'POST',
        body: { from_season: from, to_season: season.season },
      })
      toast.success(t('rolloverSuccess', { teams: resp.teams_cloned, members: resp.member_teams, from }))
      await refetchSeasons()
      await refetchTeams()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleGenerate = async () => {
    if (!season) return
    // Regenerating overwrites not-yet-booked slots (booked + blocked survive) —
    // confirm once slots already exist.
    if (slots.length > 0 && !window.confirm(t('regenerateConfirm'))) return
    setGenerating(true)
    setGenResult(null)
    try {
      const result = await generateSlots(season.id)
      setGenResult(result)
    } catch (err) {
      console.error('Slot generation failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  const volleyballTeams = (teams || []).filter(isSchedulableTeam)

  // Offer rollover when the selected season has no teams yet and a previous season
  // exists to clone from. Gated on full admin (the endpoint requires it).
  const targetHasTeams = !!season?.season && (teams || []).some(t => t.season === season.season)
  const canRollover = isGlobalAdmin && !!previousSeasonShort(season?.season) && !targetHasTeams

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">
          {t('setupTitle')}
        </h1>
        {/* The dashboard (where away-proposals are confirmed) has no menu entry
            of its own — this link is the only way to reach it from the UI. */}
        <Link
          to="/admin/terminplanung/dashboard"
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:self-auto dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {t('dashboardTitle')}
          <span aria-hidden>→</span>
        </Link>
      </div>

      {/* Row 1: Season + Game Saturdays — two cards per row on desktop */}
      <div className={season ? 'grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start' : ''}>
        {/* Season Config */}
        <SeasonConfig
          season={season}
          allSeasons={allSeasons}
          onCreateSeason={handleCreateSeason}
          onSelectSeason={setSeason}
          onStatusChange={handleStatusChange}
          onUpdateSeason={async (patch) => {
            if (season) await updateSeason(season.id, patch)
          }}
          onAfterArchive={refetchSeasons}
          canRollover={canRollover}
          onRollover={handleRollover}
        />

        {/* Spielsamstage Editor */}
        {season && (
          <SpielsamstageEditor
            spielsamstage={season.spielsamstage || []}
            onUpdate={handleUpdateSpielsamstage}
            season={season.season}
          />
        )}
      </div>

      {season && (
        <>
          {/* Team Slot Configuration (full width — has its own team grid) */}
          <TeamSlotConfigPanel
            teams={volleyballTeams}
            config={season.team_slot_config || {}}
            onUpdate={handleUpdateTeamConfig}
          />

          {/* Config panels — two cards per row on desktop */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            {/* Game-spacing gaps (home / proposals / lenient 3rd proposal) */}
            <GapConfigPanel gapConfig={season.gap_config} onUpdate={handleUpdateGapConfig} />

            {/* Intra-club derby dates (Art. 27) — fix first, then opponents slot in
                behind them. Needs the SVRZ feed, which syncs when the season opens. */}
            {season.status === 'open' && <DerbyPanel seasonId={season.id} />}

            {/* Excel Import */}
            <ExcelImportPanel />

            {/* Slot Generation */}
            <SlotGenerationPanel
              seasonStatus={season.status}
              generating={generating}
              genResult={genResult}
              hasSlots={slots.length > 0}
              slots={slots}
              teams={volleyballTeams}
              onGenerate={handleGenerate}
            />
          </div>

          {/* Invites (admin-issued per-verein links — full width) */}
          {season.status === 'open' && (
            <InvitesPanel
              teams={volleyballTeams}
              seasonId={season.id}
              seasonName={season.season || ''}
            />
          )}
        </>
      )}
    </div>
  )
}
