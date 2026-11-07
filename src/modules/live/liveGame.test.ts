import { describe, expect, it } from 'vitest'
import { isEmptyGameLink, isUpNext, matchGameByTeams, normaliseTeamName, refereeNames, sameTeams, scheduledTimeToday, staleSince } from './liveGame'
import { homeIsTeamA, teamLabel, toTeams } from './scoreboard'
import type { BoardState, Envelope } from './types'

describe('normaliseTeamName', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normaliseTeamName('VBC RÄMI D1')).toBe('vbc rami d1')
    expect(normaliseTeamName('  KSC  Wiedikon-D1 ')).toBe('ksc wiedikon d1')
    expect(normaliseTeamName(null)).toBe('')
  })
})

describe('matchGameByTeams', () => {
  const games = [
    { id: 429, home_team: 'KSC Wiedikon D1', away_team: 'VBC Rämi D1' },
    { id: 690, home_team: 'KSC Wiedikon Lions D1', away_team: 'Zug Basket D1' },
  ]
  it('finds the game in either order', () => {
    expect(matchGameByTeams(games, 'KSC WIEDIKON D1', 'VBC RÄMI D1')?.id).toBe(429)
    expect(matchGameByTeams(games, 'VBC Rämi D1', 'KSC Wiedikon D1')?.id).toBe(429)
  })
  it('returns null without a match, on blank names, or when two games match', () => {
    expect(matchGameByTeams(games, 'KSCW D1', 'RÄMI D1')).toBeNull()
    expect(matchGameByTeams(games, '', 'VBC Rämi D1')).toBeNull()
    expect(matchGameByTeams([...games, { id: 1, home_team: 'VBC Rämi D1', away_team: 'KSC Wiedikon D1' }], 'KSC Wiedikon D1', 'VBC Rämi D1')).toBeNull()
  })
})

describe('refereeNames', () => {
  it('reads the names in order and skips blanks', () => {
    expect(refereeNames([{ name: 'Anna Muster' }, { name: ' ' }, { name: 'Ben Beispiel' }])).toEqual(['Anna Muster', 'Ben Beispiel'])
  })
  it('accepts a JSON string and survives junk', () => {
    expect(refereeNames('[{"name":"Anna Muster","id":1}]')).toEqual(['Anna Muster'])
    expect(refereeNames('not json')).toEqual([])
    expect(refereeNames(null)).toEqual([])
  })
})

describe('sameTeams', () => {
  it('matches in either order and ignores spelling', () => {
    expect(sameTeams('KSC WIEDIKON D1', 'VBC RÄMI D1', 'VBC Rämi D1', 'KSC Wiedikon D1')).toBe(true)
  })
  it('a different pairing or a blank name is no match', () => {
    expect(sameTeams('KSC Wiedikon D1', 'VBC Rämi D1', 'KSC Wiedikon H1', 'VBC Rämi D1')).toBe(false)
    expect(sameTeams('', '', '', '')).toBe(false)
  })
})

describe('isUpNext', () => {
  const now = new Date('2026-11-07T14:40:00Z')
  const ready = {
    points_a: 0, points_b: 0, sets_won_a: 0, sets_won_b: 0, timeouts_a: 0, timeouts_b: 0,
    subs_a: 0, subs_b: 0, fouls_a: 0, fouls_b: 0, set_results: [],
  } as unknown as BoardState
  const env = (over: Partial<Envelope> = {}, match: Partial<BoardState> = {}) =>
    ({ status: 'live', updatedAt: '2026-11-07T14:30:05Z', match: { ...ready, ...match }, ...over }) as Envelope

  it('is true for a live row where nothing has been played yet today', () => {
    expect(isUpNext(env(), now)).toBe(true)
  })
  it.each([
    ['a point', { points_a: 1 }],
    ['a set', { sets_won_b: 1 }],
    ['a timeout', { timeouts_a: 1 }],
    ['a substitution', { subs_b: 1 }],
    ['a team foul', { fouls_a: 1 }],
    ['a finished set', { set_results: [{ a: 25, b: 20 }] }],
  ])('%s ends it', (_label, match) => {
    expect(isUpNext(env({}, match as Partial<BoardState>), now)).toBe(false)
  })
  it('is false when final, without a match, or with nothing read yet', () => {
    expect(isUpNext(env({ status: 'final' }), now)).toBe(false)
    expect(isUpNext(env({ match: null }), now)).toBe(false)
    expect(isUpNext(null, now)).toBe(false)
  })
  it('a row left over from another Zurich day is not next, even a few hours old', () => {
    expect(isUpNext(env({ updatedAt: '2026-11-06T22:59:00Z' }), now)).toBe(false)
    expect(isUpNext(env({ updatedAt: '2026-11-06T23:01:00Z' }), now)).toBe(true)
    expect(isUpNext(env({ updatedAt: null }), now)).toBe(false)
  })
})

describe('scheduledTimeToday', () => {
  const now = new Date('2026-11-07T14:40:00Z')
  const game = { id: 1, home_team: 'A', away_team: 'B', date: '2026-11-07', time: '16:00:00' }
  it('gives HH:MM for a game today', () => {
    expect(scheduledTimeToday(game, now)).toBe('16:00')
  })
  it('gives null for another day, no time or no game', () => {
    expect(scheduledTimeToday({ ...game, date: '2026-11-08' }, now)).toBeNull()
    expect(scheduledTimeToday({ ...game, time: null }, now)).toBeNull()
    expect(scheduledTimeToday(null, now)).toBeNull()
  })
})

describe('staleSince', () => {
  const now = new Date('2026-11-07T15:40:00Z')
  const played = {
    points_a: 1, points_b: 0, sets_won_a: 0, sets_won_b: 0, timeouts_a: 0, timeouts_b: 0,
    subs_a: 0, subs_b: 0, fouls_a: 0, fouls_b: 0, set_results: [],
  } as unknown as BoardState
  const env = (over: Partial<Envelope> = {}) =>
    ({ status: 'live', updatedAt: '2026-11-07T15:39:00Z', ts: 0, match: played, ...over }) as Envelope

  it('null while the row is being written', () => {
    expect(staleSince(env(), now)).toBeNull()
  })
  it('the time of the last write once it stopped', () => {
    expect(staleSince(env({ updatedAt: '2026-11-07T15:00:00Z' }), now)).toBe(Date.parse('2026-11-07T15:00:00Z'))
  })
  it('a row never updated goes by its ts', () => {
    const ts = Date.parse('2026-11-07T14:53:17Z')
    expect(staleSince(env({ updatedAt: null, ts }), now)).toBe(ts)
  })
  it('never for a final row, or a warm-up that writes nothing', () => {
    expect(staleSince(env({ status: 'final', updatedAt: '2026-11-07T10:00:00Z' }), now)).toBeNull()
    const ready = { ...played, points_a: 0 } as BoardState
    expect(staleSince(env({ match: ready, updatedAt: '2026-11-07T14:30:00Z' }), now)).toBeNull()
  })
})

describe('homeIsTeamA and teamLabel', () => {
  const vb = (period: number, points_a = 0, points_b = 0) => ({ sport: 'volleyball' as const, period, points_a, points_b })
  it('home starts on the left and changes ends every set', () => {
    expect([1, 2, 3, 4].map((p) => homeIsTeamA(vb(p)))).toEqual([true, false, true, false])
  })
  it('the fifth set changes again at 8', () => {
    expect(homeIsTeamA(vb(5, 7, 5))).toBe(true)
    expect(homeIsTeamA(vb(5, 8, 5))).toBe(false)
    expect(homeIsTeamA(vb(5, 3, 8))).toBe(false)
  })
  it('a period not published counts as the first set; other sports stay put', () => {
    expect(homeIsTeamA(vb(0))).toBe(true)
    expect(homeIsTeamA({ sport: 'basketball', period: 2, points_a: 0, points_b: 0 })).toBe(true)
  })
  it('a full name, then what was typed, then Home or Away', () => {
    const t = (k: string) => k
    expect(teamLabel({ name: 'KSC WIEDIKON D1', short: 'KSCW D1', homeAway: 'home' }, t)).toBe('KSC WIEDIKON D1')
    expect(teamLabel({ name: '', short: 'KSCW D1', homeAway: 'home' }, t)).toBe('KSCW D1')
    expect(teamLabel({ name: '', short: '', homeAway: 'away' }, t)).toBe('teamAway')
  })
})

describe('toTeams tags', () => {
  const s = (over: Partial<BoardState> = {}) => ({
    sport: 'volleyball', period: 3, points_a: 0, points_b: 0, sets_won_a: 0, sets_won_b: 0, timeouts_a: 0, timeouts_b: 0,
    subs_a: 0, subs_b: 0, fouls_a: 0, fouls_b: 0, set_results: [], serving_team: null,
    team_a_name: '', team_a_short: 'KSCW D1', team_a_color: '#2563eb', team_b_name: '', team_b_short: 'WETZIKON', team_b_color: '#ef4444',
    ...over,
  }) as unknown as BoardState
  it('tags typed names, across the change of ends', () => {
    const [a, b] = toTeams(s())
    expect([a.tagged, a.homeAway, b.tagged, b.homeAway]).toEqual([true, 'home', true, 'away'])
    const [a2] = toTeams(s({ period: 4 }))
    expect(a2.homeAway).toBe('away')
  })
  it('no tag on a full name, on the board defaults, on beach, or with nothing typed', () => {
    expect(toTeams(s({ team_a_name: 'KSC WIEDIKON D1' }))[0].tagged).toBe(false)
    expect(toTeams(s({ team_a_short: 'HOME' })).map((x) => x.tagged)).toEqual([false, false])
    expect(toTeams(s({ sport: 'beach' })).map((x) => x.tagged)).toEqual([false, false])
    expect(toTeams(s({ team_a_short: '' }))[0].tagged).toBe(false)
  })
})

describe('isEmptyGameLink', () => {
  const env = (over: Partial<Envelope>) => ({ channel: 'game-437', status: 'idle', match: null, ...over }) as Envelope
  it('an idle game row sends you on', () => {
    expect(isEmptyGameLink('game-437', env({}))).toBe(true)
  })
  it('not before the first read, for another channel, or with a match on it', () => {
    expect(isEmptyGameLink('game-437', null)).toBe(false)
    expect(isEmptyGameLink('game-437', env({ channel: 'game-1' }))).toBe(false)
    expect(isEmptyGameLink('kscw', env({ channel: 'kscw' }))).toBe(false)
    expect(isEmptyGameLink('other-board', env({ channel: 'other-board' }))).toBe(false)
    expect(isEmptyGameLink('game-437', env({ status: 'final' }))).toBe(false)
    expect(isEmptyGameLink('game-437', env({ status: 'live' }))).toBe(false)
  })
})
