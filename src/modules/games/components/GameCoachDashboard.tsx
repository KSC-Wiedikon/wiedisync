import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCollection } from '../../../lib/query'
import { useMutation } from '../../../hooks/useMutation'
import { todayLocal, mostRecent01June } from '../../../utils/dateHelpers'
import AttendanceTable from '../../../components/AttendanceTable'
import EmptyState from '../../../components/EmptyState'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { BarChart3 } from 'lucide-react'
import { useGameAttendanceStats } from './useGameAttendanceStats'
import GameAttendanceDrilldown from './GameAttendanceDrilldown'
import type { Team } from '../../../types'

interface Props {
  teamId: string | null
}

export default function GameCoachDashboard({ teamId }: Props) {
  const { t } = useTranslation('games')
  const { t: tTrainings } = useTranslation('trainings')

  const { data: teamRows, isLoading: teamLoading } = useCollection<Team>('teams', {
    filter: teamId ? { id: { _eq: teamId } } : undefined,
    fields: ['id', 'dashboard_range_from', 'dashboard_range_to', 'dashboard_league_only'],
    enabled: !!teamId,
  })
  const team = teamRows?.[0]

  const today = useMemo(() => todayLocal(), [])
  const defaultFrom = useMemo(() => mostRecent01June(today), [today])
  const defaultTo = today

  const [from, setFrom] = useState<string>(team?.dashboard_range_from ?? defaultFrom)
  const [to, setTo] = useState<string>(team?.dashboard_range_to ?? defaultTo)
  const [leagueOnly, setLeagueOnly] = useState<boolean>(team?.dashboard_league_only ?? false)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null)

  useEffect(() => {
    setFrom(team?.dashboard_range_from ?? defaultFrom)
    setTo(team?.dashboard_range_to ?? defaultTo)
    setLeagueOnly(team?.dashboard_league_only ?? false)
  }, [team?.dashboard_range_from, team?.dashboard_range_to, team?.dashboard_league_only, defaultFrom, defaultTo])

  const { update } = useMutation<Team>('teams')
  const persistFrom = async (next: string) => {
    if (!team) return
    if (next > to) { setRangeError(tTrainings('rangeInvalid')); return }
    setRangeError(null)
    if (next === (team.dashboard_range_from ?? defaultFrom)) return
    await update(team.id, { dashboard_range_from: next === defaultFrom ? null : next })
  }
  const persistTo = async (next: string) => {
    if (!team) return
    if (next < from) { setRangeError(tTrainings('rangeInvalid')); return }
    setRangeError(null)
    if (next === (team.dashboard_range_to ?? defaultTo)) return
    await update(team.id, { dashboard_range_to: next === defaultTo ? null : next })
  }
  const persistLeagueOnly = async (next: boolean) => {
    if (!team) return
    if (next === (team.dashboard_league_only ?? false)) return
    await update(team.id, { dashboard_league_only: next })
  }
  const handleReset = async () => {
    if (!team) return
    setRangeError(null)
    await update(team.id, {
      dashboard_range_from: null,
      dashboard_range_to: null,
      dashboard_league_only: false,
    })
  }

  const { stats, gamesById, isLoading } = useGameAttendanceStats(teamId, { from, to }, leagueOnly)

  if (!teamId) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-10 w-10" />}
        title={t('selectTeamPrompt')}
        description=""
      />
    )
  }
  if (isLoading || teamLoading) return <LoadingSpinner />

  return (
    <div data-tour="game-coach-dashboard">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-xs font-medium text-gray-700 dark:text-gray-300">
          {tTrainings('rangeFromLabel')}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={(e) => persistFrom(e.target.value)}
            className={`mt-1 rounded-lg border px-3 py-1.5 text-sm dark:bg-gray-700 dark:text-gray-100 ${
              rangeError ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-700 dark:text-gray-300">
          {tTrainings('rangeToLabel')}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={(e) => persistTo(e.target.value)}
            className={`mt-1 rounded-lg border px-3 py-1.5 text-sm dark:bg-gray-700 dark:text-gray-100 ${
              rangeError ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={leagueOnly}
            onChange={(e) => { setLeagueOnly(e.target.checked); persistLeagueOnly(e.target.checked) }}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          {t('leagueOnly')}
        </label>
        <button type="button" onClick={handleReset} className="text-xs font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-300">
          {tTrainings('resetRange')}
        </button>
        {rangeError && <p className="w-full text-xs text-red-500">{rangeError}</p>}
      </div>

      <div data-tour="game-coach-stats">
        {stats.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-10 w-10" />}
            title={tTrainings('noDataAvailable')}
            description={tTrainings('noDataDescription')}
          />
        ) : (
          <AttendanceTable
            stats={stats}
            namespace="games"
            countColKey="gamesCol"
            expandedPlayerId={expandedPlayerId}
            onPlayerClick={(id) => setExpandedPlayerId((cur) => (cur === id ? null : id))}
            renderDrilldown={(memberId) => (
              <GameAttendanceDrilldown
                memberId={memberId}
                stats={stats}
                gamesById={gamesById}
              />
            )}
          />
        )}
      </div>
    </div>
  )
}
