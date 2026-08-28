import { describe, expect, it } from 'vitest'
import type { Game } from '../../../types'
import { buildDutySpots, weekdayShort } from './dutySpots'

const game = (id: string, opts: Partial<Game> = {}): Game =>
  ({ id, date: '2026-09-12', time: '18:00', type: 'home', status: 'scheduled', hall: 'h1', home_team: 'KSCW H1', away_team: 'Opponent', league: '2L', ...opts } as unknown as Game)

const TEAMS = new Map([['t1', 'H1'], ['t2', 'D1'], ['t3', 'HU20']])
const MEMBERS = new Map([['m1', 'Anna'], ['m2', 'Ben']])

const spots = (g: Game[], sport: 'volleyball' | 'basketball' = 'volleyball') =>
  buildDutySpots(g, sport, TEAMS, MEMBERS)

describe('buildDutySpots — volleyball', () => {
  it('emits one spot per assigned role, open when nobody signed up', () => {
    const out = spots([game('g1', { scorer_duty_team: 't1', scorer_member: 'm1', scoreboard_duty_team: 't2' })])
    expect(out.map((s) => [s.role, s.teamName, s.memberId])).toEqual([
      ['scorer', 'H1', 'm1'],
      ['scoreboard', 'D1', ''],
    ])
    expect(out[0].memberName).toBe('Anna')
    expect(out[1].memberName).toBeNull()
  })

  it('ignores roles the game has no duty for', () => {
    expect(spots([game('g1', { league: '2L' })])).toEqual([])
  })

  // A cup home game is assigned to nobody on purpose. It must still be VISIBLE —
  // it is a home game somebody has to cover — without counting as an open gap.
  it('emits a standing on-call row for a cup game nobody is assigned to', () => {
    const [s, ...rest] = spots([game('g1', { league: 'Züri Cup — Runde 2, Spiel 3' })])
    expect(rest).toEqual([])
    expect(s).toMatchObject({ role: 'cup_on_call', teamId: '', teamName: '', memberId: '', memberName: null, onCall: true })
  })

  it('marks the on-call row so callers can keep it out of the open-gap count', () => {
    // `!memberId` alone is true for both, which is exactly the trap: the overview
    // must use `!onCall && !memberId` or a cup slot paints red as an unfilled duty.
    // Distinct dates: with equal date+time the sort falls through to ROLE_ORDER,
    // which would order these by role rather than by the game they belong to.
    const out = spots([game('g1', { league: 'Züri Cup' }), game('g2', { date: '2026-09-19', scorer_duty_team: 't1' })])
    expect(out.map((x) => [x.role, x.onCall, !x.memberId])).toEqual([
      ['cup_on_call', true, true],
      ['scorer', false, true],
    ])
    expect(out.filter((x) => !x.onCall && !x.memberId)).toHaveLength(1)
  })

  it('does not add a phantom row to a cup game that WAS given a duty by hand', () => {
    const out = spots([game('g1', { league: 'Züri Cup', scorer_scoreboard_duty_team: 't2', scorer_scoreboard_member: 'm1' })])
    expect(out.map((x) => x.role)).toEqual(['scorer_scoreboard'])
    expect(out[0].onCall).toBe(false)
  })

  it('matches every cup spelling the planner does — and no league name', () => {
    const cupRow = (league: string) => spots([game('g1', { league })])[0]
    for (const league of ['Züri Cup — Runde 2, Spiel 3', 'Mobiliar Volley Cup — Tour 1, Spiel 34', 'Schweizer Cup', 'Coppa Ticino', 'Deutscher Pokal']) {
      expect(cupRow(league)?.role, league).toBe('cup_on_call')
    }
    for (const league of ['2L', 'Frauen 3. Liga Gruppe A', 'Männer U23 1. Stärkeklasse']) {
      expect(cupRow(league), league).toBeUndefined()
    }
  })

  it('leaves basketball alone — its algorithm assigns cup games a duty team like any other', () => {
    expect(spots([game('g1', { league: 'Cup' })], 'basketball')).toEqual([])
  })

  it('keeps a spot whose member no longer resolves as FILLED', () => {
    // A member who left the club is missing from the active-members query.
    // memberName is null but memberId is set — the emptiness test must use the id,
    // or "only empty spots" would list a duty somebody is already doing.
    const [s] = spots([game('g1', { scorer_duty_team: 't1', scorer_member: 'gone' })])
    expect(s.memberId).toBe('gone')
    expect(s.memberName).toBeNull()
  })

  it('emits a spot when a person is signed up but the duty team was cleared', () => {
    const [s] = spots([game('g1', { scorer_member: 'm2' })])
    expect(s).toMatchObject({ role: 'scorer', teamId: '', teamName: '', memberId: 'm2', memberName: 'Ben' })
  })

  it('covers combined and referee modes', () => {
    const out = spots([
      game('g1', { scorer_scoreboard_duty_team: 't2', scorer_scoreboard_member: 'm1' }),
      game('g2', { date: '2026-09-13', referee_duty_team: 't3' }),
    ])
    expect(out.map((s) => s.role)).toEqual(['scorer_scoreboard', 'referee'])
  })

  it('sorts by date, then time, then role', () => {
    const out = spots([
      game('late', { date: '2026-09-20', time: '14:00', scorer_duty_team: 't1' }),
      game('early2', { date: '2026-09-12', time: '20:00', scorer_duty_team: 't1' }),
      game('early1', { date: '2026-09-12', time: '16:00', scoreboard_duty_team: 't2', scorer_duty_team: 't1' }),
    ])
    expect(out.map((s) => `${s.game.id}:${s.role}`)).toEqual([
      'early1:scorer', 'early1:scoreboard', 'early2:scorer', 'late:scorer',
    ])
  })
})

describe('buildDutySpots — basketball', () => {
  it('derives scorer + timekeeper from the shared duty team', () => {
    const out = spots([game('g1', { bb_duty_team: 't1', bb_scorer_member: 'm1' })], 'basketball')
    expect(out.map((s) => [s.role, s.teamName, s.memberId])).toEqual([
      ['bb_scorer', 'H1', 'm1'],
      ['bb_timekeeper', 'H1', ''],
    ])
  })

  it('does NOT invent a 24s spot from the shared duty team', () => {
    // The 24s desk is optional and opened per game on /scorer — deriving it from
    // bb_duty_team would report an open spot on every basketball game.
    const out = spots([game('g1', { bb_duty_team: 't1' })], 'basketball')
    expect(out.some((s) => s.role === 'bb_24s_official')).toBe(false)
  })

  it('counts the 24s spot once it has its own team or an assignee', () => {
    const withTeam = spots([game('g1', { bb_duty_team: 't1', bb_24s_duty_team: 't2' })], 'basketball')
    expect(withTeam.find((s) => s.role === 'bb_24s_official')).toMatchObject({ teamName: 'D1', memberId: '' })

    // Assignee but no own team → falls back to the shared duty team for the name.
    const withPerson = spots([game('g1', { bb_duty_team: 't1', bb_24s_official: 'm2' })], 'basketball')
    expect(withPerson.find((s) => s.role === 'bb_24s_official')).toMatchObject({ teamName: 'H1', memberId: 'm2' })
  })

  it('lets a per-role duty team override the shared one', () => {
    const out = spots([game('g1', { bb_duty_team: 't1', bb_timekeeper_duty_team: 't2' })], 'basketball')
    expect(out.find((s) => s.role === 'bb_timekeeper')?.teamName).toBe('D1')
  })
})

describe('weekdayShort', () => {
  it('returns a fixed English weekday', () => {
    expect(weekdayShort('2026-09-12')).toBe('Sat')
    expect(weekdayShort('2026-09-14')).toBe('Mon')
  })

  it('returns empty for an unparseable date', () => {
    expect(weekdayShort('')).toBe('')
  })
})
