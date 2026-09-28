/**
 * Phone live scoring (migration 394) — the pure halves of live-scoring.js: the
 * plausibility check on a published score and the short team codes.
 */
import { describe, it, expect } from 'vitest'
import { cleanState, shortName, channelFor } from '../live-scoring.js'

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
