/**
 * Phone live scoring (migration 394) — the pure halves of live-scoring.js: the
 * plausibility check on a published score and the short team codes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanState, shortName, channelFor, registerLiveScoring } from '../live-scoring.js'

const base = {
  points_a: 12, points_b: 10, sets_won_a: 1, sets_won_b: 0,
  set_results: [{ a: 25, b: 21 }], status: 'live', serving_team: 'left', event: null,
}

describe('cleanState', () => {
  it('accepts a mid-match score and derives period + over', () => {
    const c = cleanState(base)
    expect(c).toMatchObject({ points_a: 12, sets_won_a: 1, period: 2, over: false, status: 'live' })
  })
  it('lets a deuce set run past 25', () => {
    expect(cleanState({ ...base, set_results: [{ a: 31, b: 29, dur: 1800 }] })).not.toBeNull()
  })
  it('refuses a set count that disagrees with the set results', () => {
    expect(cleanState({ ...base, sets_won_a: 2 })).toBeNull()
    expect(cleanState({ ...base, sets_won_b: 1 })).toBeNull()
  })
  it('refuses junk', () => {
    expect(cleanState(null)).toBeNull()
    expect(cleanState({ ...base, points_a: -1 })).toBeNull()
    expect(cleanState({ ...base, points_b: 1.5 })).toBeNull()
    expect(cleanState({ ...base, status: 'over' })).toBeNull()
    expect(cleanState({ ...base, set_results: 'x' })).toBeNull()
    expect(cleanState({ ...base, set_results: Array(6).fill({ a: 25, b: 0 }), sets_won_a: 6 })).toBeNull()
  })
  it('marks a final match over and keeps the last set as the period', () => {
    const c = cleanState({
      ...base, status: 'final', points_a: 25, points_b: 20, sets_won_a: 3,
      set_results: [{ a: 25, b: 21 }, { a: 25, b: 18 }, { a: 25, b: 20 }], event: 'match-end',
    })
    expect(c).toMatchObject({ over: true, period: 3, event: 'match-end' })
  })
})

describe('shortName', () => {
  it('reads our own club as KSCW', () => {
    expect(shortName('KSC Wiedikon H3')).toBe('KSCW')
  })
  it('takes initials, or the start of a single word', () => {
    expect(shortName('VBC Zürich Lions')).toBe('VZL')
    expect(shortName('Volero')).toBe('VOLE')
    expect(shortName('')).toBe('')
  })
})

it('names the channel after the game', () => {
  expect(channelFor(541)).toBe('game-541')
})

describe('who may score — the shared eligibility check', () => {
  afterEach(() => vi.useRealTimers())
  // Any logged-in member can open any game modal, and the check may read the VM
  // Einsatzliste on the SHARED account. Someone with no roster row on the team and no
  // call-up for the game must be decided without it (game-participant.js squadLinked).
  it('never reads Volleymanager for a member with no link to the team', async () => {
    const seen = []
    const db = (table) => {
      seen.push(table)
      const b = {}
      for (const m of ['where', 'whereNot', 'whereRaw', 'join']) b[m] = () => b
      b.first = async () => {
        if (table === 'games') return { id: 541, game_id: 'vb_406208', kscw_team: 7, type: 'away', status: 'scheduled', date: '2026-09-28', time: '20:45:00' }
        if (table === 'teams') return { sport: 'volleyball', id: 7 }
        if (table === 'members') return { id: 12, first_name: 'Anna', last_name: 'Muster' }
        return undefined
      }
      b.select = async () => []
      b.pluck = async () => []
      return b
    }
    const routes = {}
    const router = { get: (p, h) => { routes[`GET ${p}`] = h }, post: (p, h) => { routes[`POST ${p}`] = h } }
    const noop = () => {}
    const logger = { child: () => logger, info: noop, warn: noop, error: noop }
    registerLiveScoring(router, { database: db, logger })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 28, 18, 45))   // kickoff
    let body
    await routes['GET /live-scoring/game/:gameId'](
      { accountability: { user: 'u-12' }, params: { gameId: '541' } },
      { status() { return this }, json(b) { body = b } },
    )
    expect(body).toMatchObject({ can_score: false, code: 'not_participant' })
    expect(seen).toContain('member_teams')
    expect(seen).not.toContain('svrz_games')
  })
})
