/**
 * The two gates must not drift back into one.
 *
 * `isSchedulableTeam` and `hasFixtureSchedule` answer different questions, and for
 * four months they were the same function — which is why every basketball team's
 * schedule was blank and the calendar page's "Schedule" tab did not exist at all
 * for a basketball-only member (the tab renders only when some team passes). The
 * gate looked correct the whole time because basketball genuinely held no 2026/27
 * fixtures; it stopped being correct the moment ProBasket published one.
 */
import { describe, it, expect } from 'vitest'
import { hasFixtureSchedule, isSchedulableTeam } from '../schedulableTeams'
import type { Team } from '../../../../types'

const team = (over: Partial<Team>): Pick<Team, 'sport' | 'active' | 'name'> => ({
  sport: 'volleyball', active: true, name: 'H1', ...over,
} as Pick<Team, 'sport' | 'active' | 'name'>)

describe('isSchedulableTeam — the volleyball negotiation gate', () => {
  it('accepts an active volleyball team', () => {
    expect(isSchedulableTeam(team({ name: 'H3' }))).toBe(true)
  })
  it('rejects basketball: ProBasket settles the schedule, there is nothing to negotiate', () => {
    expect(isSchedulableTeam(team({ sport: 'basketball', name: 'Herren 2' }))).toBe(false)
  })
  it('rejects MiniVB and DU20 — no league fixtures to arrange', () => {
    expect(isSchedulableTeam(team({ name: 'MiniVB' }))).toBe(false)
    expect(isSchedulableTeam(team({ name: 'DU20' }))).toBe(false)
  })
  it('rejects an inactive team', () => {
    expect(isSchedulableTeam(team({ active: false }))).toBe(false)
  })
})

describe('hasFixtureSchedule — the "does this team have games to show" gate', () => {
  it('accepts an active volleyball team, exactly as before', () => {
    expect(hasFixtureSchedule(team({ name: 'H3' }))).toBe(true)
  })

  it('accepts basketball — the whole point of splitting the gate', () => {
    expect(hasFixtureSchedule(team({ sport: 'basketball', name: 'Herren 2' }))).toBe(true)
  })

  it('still rejects MiniVB and DU20 — they would render an empty box', () => {
    expect(hasFixtureSchedule(team({ name: 'MiniVB' }))).toBe(false)
    expect(hasFixtureSchedule(team({ name: 'DU20' }))).toBe(false)
  })

  it('rejects an inactive team', () => {
    expect(hasFixtureSchedule(team({ active: false, sport: 'basketball', name: 'Herren 2' }))).toBe(false)
  })

  it('is a strict superset of isSchedulableTeam — no volleyball team loses its schedule', () => {
    const cases = [
      team({ name: 'H1' }),
      team({ name: 'D4' }),
      team({ name: 'MiniVB' }),
      team({ name: 'DU20' }),
      team({ active: false }),
      team({ sport: 'basketball', name: 'Lions D1' }),
      team({ sport: 'basketball', name: 'MU8' }),
    ]
    for (const c of cases) {
      if (isSchedulableTeam(c)) expect(hasFixtureSchedule(c), `${c.sport} ${c.name}`).toBe(true)
    }
  })
})
