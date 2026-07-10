import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3 } from 'lucide-react'
import { useAttendanceStats } from './useAttendanceStats'
import EmptyState from '../../components/EmptyState'
import AttendanceTable from '../../components/AttendanceTable'
import FinesDashboardCard from '../fines/FinesDashboardCard'
import { todayLocal, mostRecent01June } from '../../utils/dateHelpers'
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
  const defaultFrom = useMemo(() => mostRecent01June(today), [today])
  const defaultTo = today

  const [from, setFrom] = useState<string>(team?.dashboard_range_from ?? defaultFrom)
  const [to, setTo] = useState<string>(team?.dashboard_range_to ?? defaultTo)
  const [rangeError, setRangeError] = useState<string | null>(null)

  // Re-sync when the team row arrives or changes via realtime.
  useEffect(() => {
    setFrom(team?.dashboard_range_from ?? defaultFrom)
    setTo(team?.dashboard_range_to ?? defaultTo)
  }, [team?.dashboard_range_from, team?.dashboard_range_to, defaultFrom, defaultTo])

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
