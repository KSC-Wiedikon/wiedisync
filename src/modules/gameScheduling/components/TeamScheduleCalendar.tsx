import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Team, GameSchedulingSeason, GameSchedulingSlot } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'
import { kscwApi } from '../../../lib/api'
import { isSchedulableTeam } from '../utils/schedulableTeams'
import SchedulingCalendar from './SchedulingCalendar'

interface TeamCalendarResponse {
  season: GameSchedulingSeason | null
  slots: GameSchedulingSlot[]
  bookings: ExpandedBooking[]
}

// Member-facing, read-only calendar of a single team's proposed + confirmed
// games. Pulls from GET /kscw/terminplanung/team-calendar/:teamId — a backend
// endpoint that returns only safe fields (no opponent contact email / invite
// token / admin notes), so any logged-in member can see it without granting
// broad reads on the scheduling collections. Renders nothing for non-schedulable
// teams (non-volleyball, MiniVB/DU20) or until the season has at least one entry.
// Pass hideWhenEmpty={false} (e.g. the calendar page's Schedule view) to render
// the empty month grid even when the team has no slots/bookings yet.
export default function TeamScheduleCalendar({ team, hideWhenEmpty = true }: { team: Team; hideWhenEmpty?: boolean }) {
  const { t } = useTranslation('gameScheduling')
  const [data, setData] = useState<TeamCalendarResponse | null>(null)

  const schedulable = isSchedulableTeam(team)

  useEffect(() => {
    if (!schedulable) {
      setData(null)
      return
    }
    let cancelled = false
    kscwApi<TeamCalendarResponse>(`/terminplanung/team-calendar/${team.id}`)
      .then((resp) => { if (!cancelled) setData(resp) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [team.id, schedulable])

  if (!schedulable || !data?.season) return null
  if (hideWhenEmpty && data.slots.length === 0 && data.bookings.length === 0) return null

  return (
    <div className="mt-8">
      <SchedulingCalendar
        slots={data.slots}
        bookings={data.bookings}
        teams={[team]}
        season={data.season}
        title={t('teamCalendarTitle')}
      />
    </div>
  )
}
