import { describe, expect, it } from 'vitest'
import { isUpNext, matchGameByTeams, normaliseTeamName, refereeNames, sameTeams, scheduledTimeToday } from './liveGame'
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
