import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3 } from 'lucide-react'
import { useAttendanceStats } from './useAttendanceStats'
import EmptyState from '../../components/EmptyState'
import AttendanceTable from '../../components/AttendanceTable'
import FinesDashboardCard from '../fines/FinesDashboardCard'
import { todayLocal } from '../../utils/dateHelpers'
import { seasonRolloverDate } from '../../utils/season'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import LoadingSpinner from '../../components/LoadingSpinner'
import DatePicker from '@/components/ui/DatePicker'
import type { Team } from '../../types'

interface CoachDashboardProps {
  teamId: string
}

export default function CoachDashboard({ teamId }: CoachDashboardProps) {
  const { t } = useTranslation('trainings')

  const { data: teamRows, isLoading: teamLoading } = useCollection<Team>('teams', {
    filter: { id: { _eq: teamId } },
    fields: ['id', 'dashboard_range_from', 'dashboard_range_to', 'dashboard_league_only'],
    enabled: !!teamId,
  })
  const team = teamRows?.[0]

  const today = useMemo(() => todayLocal(), [])
  // The shared Jun-1 rollover anchor (season.ts) — was a second, untested
  // inline copy of the same cutover fed by the device clock.
  const defaultFrom = useMemo(() => seasonRolloverDate(), [])
  const defaultTo = today

  const syncedFrom = team?.dashboard_range_from ?? defaultFrom
  const syncedTo = team?.dashboard_range_to ?? defaultTo

  const [from, setFrom] = useState<string>(syncedFrom)
  const [to, setTo] = useState<string>(syncedTo)
  const [rangeError, setRangeError] = useState<string | null>(null)

  // Re-sync when the team row arrives or changes via realtime. Adjust-state-
  // during-render (same trigger the old effect had — a change in either persisted
  // bound, `defaultFrom`/`defaultTo` being memo-stable) instead of an effect.
  const [syncedRange, setSyncedRange] = useState({ from: syncedFrom, to: syncedTo })
  if (syncedRange.from !== syncedFrom || syncedRange.to !== syncedTo) {
    setSyncedRange({ from: syncedFrom, to: syncedTo })
    setFrom(syncedFrom)
    setTo(syncedTo)
  }

  const { stats, isLoading } = useAttendanceStats(teamId, { from, to })

  const { update } = useMutation<Team>('teams')

  const persistFrom = async (next: string) => {
    if (!team) return
    if (next > to) {
      setRangeError(t('rangeInvalid'))
      return
    }
    setRangeError(null)
    if (next === (team.dashboard_range_from ?? defaultFrom)) return // no-op
    await update(team.id, { dashboard_range_from: next === defaultFrom ? null : next })
  }

  const persistTo = async (next: string) => {
    if (!team) return
    if (next < from) {
      setRangeError(t('rangeInvalid'))
      return
    }
    setRangeError(null)
    if (next === (team.dashboard_range_to ?? defaultTo)) return
    await update(team.id, { dashboard_range_to: next === defaultTo ? null : next })
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

  if (isLoading || teamLoading) {
    return <LoadingSpinner />
  }

  return (
    <div data-tour="attendance-stats">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <DatePicker
          label={t('rangeFromLabel')}
          value={from}
          onChange={(v) => { setFrom(v); persistFrom(v) }}
        />
        <DatePicker
          label={t('rangeToLabel')}
          value={to}
          onChange={(v) => { setTo(v); persistTo(v) }}
        />
        <button
          type="button"
          onClick={handleReset}
          className="text-xs font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-300"
        >
          {t('resetRange')}
        </button>
        {rangeError && (
          <p className="w-full text-xs text-red-500">{rangeError}</p>
        )}
      </div>

      {stats.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" />}
          title={t('noDataAvailable')}
          description={t('noDataDescription')}
        />
      ) : (
        <AttendanceTable stats={stats} />
      )}

      <div className="mt-6">
        <FinesDashboardCard teamId={teamId} />
      </div>
    </div>
  )
}
