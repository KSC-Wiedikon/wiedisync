import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Team, GameSchedulingSeason, GameSchedulingSlot } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'
import { fetchAllItems, kscwApi } from '../../../lib/api'
import { isSchedulableTeam } from '../utils/schedulableTeams'
import SchedulingCalendar, { type CalendarGame } from './SchedulingCalendar'
import TeamScheduleList from './TeamScheduleList'

interface TeamCalendarResponse {
  season: GameSchedulingSeason | null
  slots: GameSchedulingSlot[]
  bookings: ExpandedBooking[]
}

// Member-facing, read-only calendar of a single team's proposed + confirmed
// games. Pulls from GET /kscw/terminplanung/team-calendar/:teamId — a backend
// endpoint that returns only safe fields (no opponent contact email / invite
// token / admin notes), so any logged-in member can see it without granting
// broad reads on the scheduling collections. The endpoint supplies the OPEN
// side of the schedule (free slots, blocks, pending proposals); the fixtures
// themselves come from `games` — see below. Renders nothing for non-schedulable
// teams (non-volleyball, MiniVB/DU20) or until the season has at least one entry.
// Pass hideWhenEmpty={false} (e.g. the calendar page's Schedule view) to render
// even when the team has no slots/bookings yet. variant='list' renders the
// chronological TeamScheduleList instead of the month grid (calendar page's
// "Schedule" tab); 'calendar' (default) keeps the SchedulingCalendar month grid
// used on the team detail page.
export default function TeamScheduleCalendar({ team, hideWhenEmpty = true, variant = 'calendar' }: { team: Team; hideWhenEmpty?: boolean; variant?: 'calendar' | 'list' }) {
  const { t } = useTranslation('gameScheduling')
  const [data, setData] = useState<TeamCalendarResponse | null>(null)

  const schedulable = isSchedulableTeam(team)

  // Drop a previously loaded calendar the moment the team stops being
  // schedulable — React's adjust-state-during-render pattern, replacing the
  // `setData(null)` that used to sit synchronously in the effect below.
  // (Nothing paints in that state anyway: the guard below returns null.)
  const [prevSchedulable, setPrevSchedulable] = useState(schedulable)
  if (prevSchedulable !== schedulable) {
    setPrevSchedulable(schedulable)
    if (!schedulable) setData(null)
  }

  useEffect(() => {
    if (!schedulable) return
    let cancelled = false
    kscwApi<TeamCalendarResponse>(`/terminplanung/team-calendar/${team.id}`)
      .then((resp) => { if (!cancelled) setData(resp) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [team.id, schedulable])

  // The team's fixtures, straight from `games` — the VolleyManager / Swiss
  // Volley feed. This is the schedule a player actually plays, so it is what the
  // calendar shows (`confirmedFrom='games'` below); the scheduling collections
  // only supply what is still OPEN. Reconstructing games from bookings instead
  // silently drops every fixture that never had one — derbies above all (both
  // sides are KSCW, so no `game_scheduling_opponents` row exists to book
  // against), plus cup and manually placed games — and goes stale the moment
  // the federation re-dates a game after we booked it. `games` read is
  // club-wide for members, so the plain items API is enough here.
  const [games, setGames] = useState<CalendarGame[]>([])
  const seasonLabel = data?.season?.season
  useEffect(() => {
    // No reset here: nothing renders without a season anyway (the guard below
    // returns null), and a synchronous setState in an effect body cascades.
    if (!schedulable || !seasonLabel) return
    let cancelled = false
    fetchAllItems<CalendarGame>('games', {
      filter: { season: { _eq: seasonLabel }, kscw_team: { _eq: team.id } },
      fields: ['id', 'game_id', 'date', 'time', 'home_team', 'away_team', 'kscw_team', 'type', 'hall', 'away_hall_json'],
    }).then((g) => { if (!cancelled) setGames(g) })
      .catch(() => { if (!cancelled) setGames([]) })
    return () => { cancelled = true }
  }, [schedulable, seasonLabel, team.id])

  if (!schedulable || !data?.season) return null
  if (hideWhenEmpty && data.slots.length === 0 && data.bookings.length === 0 && games.length === 0) return null

  return (
    <div className="mt-8">
      {variant === 'list' ? (
        <TeamScheduleList slots={data.slots} bookings={data.bookings} team={team} season={data.season} games={games} confirmedFrom="games" />
      ) : (
        <SchedulingCalendar
          slots={data.slots}
          bookings={data.bookings}
          teams={[team]}
          season={data.season}
          games={games}
          confirmedFrom="games"
          title={t('teamCalendarTitle')}
        />
      )}
    </div>
  )
}
