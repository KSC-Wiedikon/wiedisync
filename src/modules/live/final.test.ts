import { describe, expect, it } from 'vitest'
import { buildFinalView, durationParts, formatDuration, totalSetDuration } from './final'
import { normaliseSetResult } from './scoreboard'
import type { BoardState } from './types'

function board(over: Partial<BoardState> = {}): BoardState {
  return {
    sport: 'volleyball',
    side_a: 'left',
    team_a_name: 'KSC Wiedikon',
    team_a_short: 'KSCW',
    team_a_color: '#4A55A2',
    team_b_name: 'Volley Zürich',
    team_b_short: 'VZ',
    team_b_color: '#ef4444',
    points_a: 15,
    points_b: 12,
    sets_won_a: 3,
    sets_won_b: 1,
    timeouts_a: 0,
    timeouts_b: 0,
    subs_a: 0,
    subs_b: 0,
    fouls_a: 0,
    fouls_b: 0,
    period: 4,
    over: true,
    serving_team: 'left',
    set_results: [],
    ...over,
  }
}

const tr = (key: string, o: { h?: number; m: number }) =>
  key === 'durationHourMin' ? `${o.h} h ${o.m} min` : `${o.m} min`

describe('buildFinalView — volleyball', () => {
  it('lists every set with its winner and duration, and sums the match time', () => {
    const v = buildFinalView(
      board({
        set_results: [
          { a: 25, b: 23, dur: 1440 },
          { a: 20, b: 25, dur: 1500 },
          { a: 25, b: 18, dur: 1320 },
          { a: 25, b: 22, dur: 1560 },
        ],
      }),
    )
    expect(v.bySets).toBe(true)
    expect(v.score).toEqual([3, 1])
    expect(v.winner).toBe(0)
    expect(v.sets.map((s) => [s.n, s.a, s.b, s.winner, s.dur])).toEqual([
      [1, 25, 23, 0, 1440],
      [2, 20, 25, 1, 1500],
      [3, 25, 18, 0, 1320],
      [4, 25, 22, 0, 1560],
    ])
    expect(v.totalDur).toBe(5820)
    expect(v.basketballEnd).toBeNull()
  })

  it('shows no match time when any set lacks a duration', () => {
    const v = buildFinalView(
      board({ sets_won_a: 0, sets_won_b: 3, set_results: [{ a: 20, b: 25, dur: 1400 }, { a: 22, b: 25 }, { a: 19, b: 25, dur: 1300 }] }),
    )
    expect(v.sets[1].dur).toBeNull()
    expect(v.totalDur).toBeNull()
    expect(v.winner).toBe(1)
  })

  it('has no match time and no rows when there are no set results', () => {
    const v = buildFinalView(board({ set_results: [] }))
    expect(v.sets).toEqual([])
    expect(v.totalDur).toBeNull()
  })

  it('reports no winner on a level set score', () => {
    const v = buildFinalView(board({ sets_won_a: 1, sets_won_b: 1, set_results: [{ a: 25, b: 20 }, { a: 20, b: 25 }] }))
    expect(v.winner).toBeNull()
  })

  it('derives the set score from the results when the tally is missing', () => {
    const v = buildFinalView(board({ sets_won_a: 0, sets_won_b: 0, set_results: [{ a: 21, b: 15 }, { a: 21, b: 18 }] }))
    expect(v.score).toEqual([2, 0])
    expect(v.winner).toBe(0)
  })

  it('works the same for beach', () => {
    const v = buildFinalView(board({ sport: 'beach', sets_won_a: 2, sets_won_b: 0, set_results: [{ a: 21, b: 15, dur: 900 }, { a: 21, b: 19, dur: 1100 }] }))
    expect(v.totalDur).toBe(2000)
    expect(v.sets).toHaveLength(2)
  })
})

describe('buildFinalView — basketball', () => {
  it('decides on points, lists no sets, ends in regulation after Q4', () => {
    const v = buildFinalView(board({ sport: 'basketball', points_a: 64, points_b: 71, period: 4, set_results: [{ a: 1, b: 2, dur: 5 }] }))
    expect(v.bySets).toBe(false)
    expect(v.score).toEqual([64, 71])
    expect(v.winner).toBe(1)
    expect(v.sets).toEqual([])
    expect(v.totalDur).toBeNull()
    expect(v.basketballEnd).toEqual({ kind: 'regulation' })
  })

  it('names the overtime and a board stopped early', () => {
    expect(buildFinalView(board({ sport: 'basketball', period: 6 })).basketballEnd).toEqual({ kind: 'overtime', n: 2 })
    expect(buildFinalView(board({ sport: 'basketball', period: 3 })).basketballEnd).toEqual({ kind: 'partial', n: 3 })
    expect(buildFinalView(board({ sport: 'basketball', period: 0 })).basketballEnd).toBeNull()
  })

  it('can end level', () => {
    expect(buildFinalView(board({ sport: 'basketball', points_a: 70, points_b: 70 })).winner).toBeNull()
  })
})

describe('durations', () => {
  it('rounds seconds to whole minutes', () => {
    expect(durationParts(1440)).toEqual({ h: 0, m: 24 })
    expect(durationParts(1469)).toEqual({ h: 0, m: 24 })
    expect(durationParts(1470)).toEqual({ h: 0, m: 25 })
    expect(durationParts(10)).toEqual({ h: 0, m: 1 })
    expect(durationParts(0)).toEqual({ h: 0, m: 0 })
    expect(durationParts(5820)).toEqual({ h: 1, m: 37 })
  })

  it('formats minutes, and hours from an hour up', () => {
    expect(formatDuration(1440, tr)).toBe('24 min')
    expect(formatDuration(3600, tr)).toBe('1 h 0 min')
    expect(formatDuration(5820, tr)).toBe('1 h 37 min')
  })

  it('totals history rows only when every set was timed', () => {
    expect(totalSetDuration([{ dur: 60 }, { dur: 120 }])).toBe(180)
    expect(totalSetDuration([{ dur: 60 }, {}])).toBeNull()
    expect(totalSetDuration([])).toBeNull()
    expect(totalSetDuration(null)).toBeNull()
  })
})

describe('normaliseSetResult', () => {
  it('keeps a valid dur and coerces string numbers', () => {
    expect(normaliseSetResult({ a: '25', b: 23, dur: '1440' })).toEqual({ a: 25, b: 23, dur: 1440 })
    expect(normaliseSetResult({ a: 25, b: 23, dur: 1439.6 })).toEqual({ a: 25, b: 23, dur: 1440 })
  })

  it('drops a missing or invalid dur', () => {
    expect(normaliseSetResult({ a: 25, b: 23 })).toEqual({ a: 25, b: 23 })
    expect(normaliseSetResult({ a: 25, b: 23, dur: null })).toEqual({ a: 25, b: 23 })
    expect(normaliseSetResult({ a: 25, b: 23, dur: -5 })).toEqual({ a: 25, b: 23 })
    expect(normaliseSetResult({ a: 25, b: 23, dur: 'abc' })).toEqual({ a: 25, b: 23 })
    expect(normaliseSetResult({ a: 25, b: 23, dur: '' })).toEqual({ a: 25, b: 23 })
    expect('dur' in normaliseSetResult(null)).toBe(false)
  })
})
