import { describe, it, expect } from 'vitest'
import { EMPTY_STATE, addPoint, removePoint, nextSet, closedWinner, currentSet, matchOver, finish, type ScoreState, type Side } from './scoring'

const tap = (st: ScoreState, side: Side, n: number) => {
  let s = st
  for (let i = 0; i < n; i++) s = addPoint(s, side)
  return s
}
/** Play a set to a:b (the loser's points first, so the set only closes at the end). */
const playSet = (st: ScoreState, a: number, b: number) => {
  const s = a > b ? tap(tap(st, 'b', b), 'a', a) : tap(tap(st, 'a', a), 'b', b)
  return nextSet(s)
}

describe('scoring', () => {
  it('goes live on the first point and gives the serve to the rally winner', () => {
    const s = addPoint(EMPTY_STATE, 'b')
    expect(s).toMatchObject({ points_b: 1, status: 'live', serving_team: 'right' })
  })

  it('awards the set at 25 by two, once', () => {
    let s = tap(tap(EMPTY_STATE, 'b', 23), 'a', 25)
    expect(s.sets_won_a).toBe(1)
    expect(s.set_results).toEqual([{ a: 25, b: 23 }])
    expect(s.event).toBe('set-end')
    expect(closedWinner(s)).toBe('a')
    // Double tap on the set point: nothing moves.
    expect(addPoint(s, 'a')).toBe(s)
    // The loser can still be corrected upward — and that does not award a second set.
    s = addPoint(s, 'b')
    expect(s.sets_won_b).toBe(0)
    expect(s.sets_won_a).toBe(1)
    // …nor does the winner's next "+" at 26:24 (point-hub's setClosed, carried in `event`).
    s = addPoint(s, 'a')
    expect(s).toMatchObject({ points_a: 26, sets_won_a: 1, set_results: [{ a: 25, b: 23 }] })
  })

  it('after a loser correction the winner\'s "−" to a tie takes the set back', () => {
    let s = tap(tap(EMPTY_STATE, 'b', 23), 'a', 25)
    s = addPoint(s, 'b') // 25:24
    s = removePoint(s, 'a') // 24:24
    expect(s).toMatchObject({ sets_won_a: 0, set_results: [], event: null })
  })

  it('runs deuce past 25', () => {
    const s = tap(tap(tap(EMPTY_STATE, 'a', 24), 'b', 24), 'a', 1)
    expect(s.sets_won_a).toBe(0)
    const w = tap(tap(s, 'b', 2), 'b', 1)
    expect(w.sets_won_b).toBe(1)
    expect(w.set_results).toEqual([{ a: 25, b: 27 }])
  })

  it('a winner\'s "−" below the winning score takes the set back', () => {
    const s = tap(tap(EMPTY_STATE, 'b', 23), 'a', 25)
    const back = removePoint(s, 'a')
    expect(back).toMatchObject({ points_a: 24, sets_won_a: 0, set_results: [] })
    // …and the real set point then counts exactly once.
    expect(addPoint(back, 'a').sets_won_a).toBe(1)
  })

  it('the loser\'s "−" never pops a set', () => {
    const s = tap(tap(EMPTY_STATE, 'b', 23), 'a', 25)
    expect(removePoint(s, 'b')).toMatchObject({ sets_won_a: 1, points_b: 22 })
  })

  it('next set clears the points only after a won set', () => {
    expect(nextSet(tap(EMPTY_STATE, 'a', 10))).toMatchObject({ points_a: 10 })
    const s = playSet(EMPTY_STATE, 25, 20)
    expect(s).toMatchObject({ points_a: 0, points_b: 0, sets_won_a: 1 })
    expect(currentSet(s)).toBe(2)
  })

  it('plays the fifth set to 15 and ends the match', () => {
    let s = playSet(EMPTY_STATE, 25, 20)
    s = playSet(s, 20, 25)
    s = playSet(s, 25, 20)
    s = playSet(s, 20, 25)
    expect(currentSet(s)).toBe(5)
    s = tap(tap(s, 'b', 13), 'a', 15)
    expect(s.sets_won_a).toBe(3)
    expect(matchOver(s)).toBe(true)
    expect(s.event).toBe('match-end')
    // No sixth set; the winner's double tap is refused, a loser's correction awards nothing.
    expect(nextSet(s)).toBe(s)
    expect(addPoint(s, 'a')).toBe(s)
    expect(addPoint(s, 'b')).toMatchObject({ points_b: 14, sets_won_b: 2, event: 'match-end' })
    expect(finish(s).status).toBe('final')
  })

  it('a 3:0 ends the match without a fourth set', () => {
    let s = playSet(EMPTY_STATE, 25, 10)
    s = playSet(s, 25, 10)
    s = tap(tap(s, 'b', 10), 'a', 25)
    expect(matchOver(s)).toBe(true)
    expect(s.event).toBe('match-end')
  })
})
