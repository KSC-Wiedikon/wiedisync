import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Team, GameSchedulingSeason, GameSchedulingSlot } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'
import { fetchAllItems, kscwApi } from '../../../lib/api'
import { hasFixtureSchedule, isSchedulableTeam } from '../utils/schedulableTeams'
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
// themselves come from `games` — see below.
//
// ⚠ TWO GATES, not one. `hasFixtureSchedule` decides whether this team has games
// worth listing (any sport); `isSchedulableTeam` decides whether it also has a
// volleyball NEGOTIATION to show. Basketball passes the first and fails the
// second: ProBasket settles the schedule at the Spielplansitzung, so there are no
// slots, no invites and no proposals — but there is a full fixture list, and
// collapsing the two gates into one is what left every basketball team's schedule
// blank (and hid the calendar page's "Schedule" tab from a basketball-only member
// entirely, since that tab only appears when some team passes).
//
// Pass hideWhenEmpty={false} (e.g. the calendar page's Schedule view) to render
// even when the team has no slots/bookings yet. variant='list' renders the
// chronological TeamScheduleList instead of the month grid (calendar page's
// "Schedule" tab); 'calendar' (default) keeps the SchedulingCalendar month grid
// used on the team detail page.
export default function TeamScheduleCalendar({ team, hideWhenEmpty = true, variant = 'calendar' }: { team: Team; hideWhenEmpty?: boolean; variant?: 'calendar' | 'list' | 'proposals' }) {
  const { t } = useTranslation('gameScheduling')
  const [data, setData] = useState<TeamCalendarResponse | null>(null)

  /** Has a volleyball negotiation (slots, invites, proposals) — see the header. */
  const schedulable = isSchedulableTeam(team)
  /** Has a fixture list worth showing, whichever sport produced it. */
  const showsFixtures = hasFixtureSchedule(team)

  // Drop a previously loaded calendar the moment the team stops qualifying —
  // React's adjust-state-during-render pattern, replacing the `setData(null)` that
  // used to sit synchronously in the effect below.
  // (Nothing paints in that state anyway: the guard below returns null.)
  const [prevShowsFixtures, setPrevShowsFixtures] = useState(showsFixtures)
  if (prevShowsFixtures !== showsFixtures) {
    setPrevShowsFixtures(showsFixtures)
    if (!showsFixtures) setData(null)
  }

  // Called for a basketball team too, and deliberately: `game_scheduling_seasons`
  // is the SHARED season table (the basketball settings page reads the same row),
  // so this is how the season label below is resolved. A basketball team simply
  // comes back with empty `slots`/`bookings`, which is the truth.
  useEffect(() => {
    if (!showsFixtures) return
    let cancelled = false
    kscwApi<TeamCalendarResponse>(`/terminplanung/team-calendar/${team.id}`)
      .then((resp) => { if (!cancelled) setData(resp) })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [team.id, showsFixtures])

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
    if (!showsFixtures || !seasonLabel || variant === 'proposals') return
    let cancelled = false
    fetchAllItems<CalendarGame>('games', {
      filter: { season: { _eq: seasonLabel }, kscw_team: { _eq: team.id } },
      fields: ['id', 'game_id', 'date', 'time', 'home_team', 'away_team', 'kscw_team', 'type', 'hall', 'away_hall_json'],
    }).then((g) => { if (!cancelled) setGames(g) })
      .catch(() => { if (!cancelled) setGames([]) })
    return () => { cancelled = true }
  }, [showsFixtures, seasonLabel, team.id, variant])

  if (!showsFixtures || !data?.season) return null
  // 'proposals' renders nothing at all once every fixture is agreed — which, mid
  // season, is most of the time. Deciding that HERE rather than inside the list is
  // what stops an empty `mt-8` wrapper leaving a dead gap on the team page.
  // A non-schedulable team has no negotiation at all, so it short-circuits here
  // rather than relying on `bookings` happening to be empty.
  if (variant === 'proposals') {
    if (!schedulable) return null
    const hasPending = data.bookings.some(
      (b) => b.status === 'pending' && (b.type === 'away_proposal' || b.type === 'home_slot_pick'),
    )
    if (!hasPending) return null
  } else if (hideWhenEmpty && data.slots.length === 0 && data.bookings.length === 0 && games.length === 0) {
    return null
  }

  return (
    <div className="mt-8">
      {variant === 'proposals' ? (
        <TeamScheduleList
          slots={data.slots}
          bookings={data.bookings}
          team={team}
          season={data.season}
          confirmedFrom="games"
          hideConfirmed
          showHeading={false}
        />
      ) : variant === 'list' ? (
        <TeamScheduleList slots={data.slots} bookings={data.bookings} team={team} season={data.season} games={games} confirmedFrom="games" />
      ) : (
        <SchedulingCalendar
          slots={data.slots}
          bookings={data.bookings}
          teams={[team]}
          season={data.season}
          games={games}
          confirmedFrom="games"
          // A basketball game at KWI is a hall fact the volleyball PLANNER needs
          // (that court is gone); on a volleyball team's own page it is another
          // sport's fixture and simply not this team's schedule.
          showCrossSport={false}
          title={t('teamCalendarTitle')}
        />
      )}
    </div>
  )
}
