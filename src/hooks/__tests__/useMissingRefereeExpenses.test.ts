/**
 * missingRefereeGames — the pure core of the Home referee-expense nudge.
 *
 * "Ended" is `startMsOf(game) + DUTY_EVENT_DURATION_MS <= now`, shared with the
 * duty banner so both surfaces agree on when a match is over. The id comparison
 * is stringly on both sides on purpose: `fetchItems` hands FK ids back as
 * strings (`referee_expenses.game === "123"`) while a game's own `id` can be a
 * number, and a strict `===` would report every recorded game as missing.
 */
import { describe, it, expect } from 'vitest'
import { missingRefereeGames, refereeGameEnded } from '../useMissingRefereeExpenses'
import { startMsOf, DUTY_EVENT_DURATION_MS } from '../useMyDuties'

type G = { id: string | number; date: string; time: string }

const game = (id: string | number, date = '2026-09-12', time = '18:00:00'): G => ({ id, date, time })

/** Epoch ms of a game's end, derived through the same helper the hook uses. */
const endOf = (g: G): number => {
  const start = startMsOf(g)
  if (start == null) throw new Error('fixture has no kickoff')
  return start + DUTY_EVENT_DURATION_MS
}

describe('refereeGameEnded', () => {
  it('is false before the match window closes and true from the boundary on', () => {
    const g = game(1)
    expect(refereeGameEnded(g, endOf(g) - 1)).toBe(false)
    expect(refereeGameEnded(g, endOf(g))).toBe(true)
    expect(refereeGameEnded(g, endOf(g) + 60_000)).toBe(true)
  })

  it('is false for a row without date/time (never "ended", never nudged)', () => {
    expect(refereeGameEnded({ date: '', time: '18:00:00' }, Number.MAX_SAFE_INTEGER)).toBe(false)
    expect(refereeGameEnded({ date: '2026-09-12', time: '' }, Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})

describe('missingRefereeGames', () => {
  it('excludes a game that has not ended yet, even with no row', () => {
    const g = game(1)
    expect(missingRefereeGames([g], [], endOf(g) - 1)).toEqual([])
  })

  it('excludes an ended game that already has a referee_expenses row', () => {
    const g = game(1)
    expect(missingRefereeGames([g], [{ id: 10, game: 1 }], endOf(g))).toEqual([])
  })

  it('includes an ended game with no row', () => {
    const g = game(1)
    expect(missingRefereeGames([g], [], endOf(g))).toEqual([g])
  })

  it('matches ids across string/number representations', () => {
    const a = game(1)          // numeric game id, string row FK (what fetchItems returns)
    const b = game('2')        // string game id, numeric row FK
    const now = Math.max(endOf(a), endOf(b))
    expect(missingRefereeGames([a, b], [{ id: 'x', game: '1' }, { id: 'y', game: 2 }], now)).toEqual([])
    // and a row for some OTHER game does not cover them
    expect(missingRefereeGames([a, b], [{ id: 'z', game: '3' }], now)).toEqual([a, b])
  })

  it('ignores rows whose game FK is null', () => {
    const g = game(1)
    expect(missingRefereeGames([g], [{ id: 'orphan', game: null }], endOf(g))).toEqual([g])
  })

  it('keeps the input order and mixes ended/not-ended/recorded correctly', () => {
    const earlier = game(1, '2026-09-10')
    const recorded = game(2, '2026-09-11')
    const tonight = game(3, '2026-09-12', '20:00:00')
    const now = endOf(recorded) + 1 // earlier + recorded are over, tonight is not
    expect(missingRefereeGames([earlier, recorded, tonight], [{ id: 1, game: '2' }], now)).toEqual([earlier])
  })
})
