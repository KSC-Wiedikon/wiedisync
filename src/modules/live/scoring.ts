/**
 * Volleyball rally scoring for phone live scoring (`/live/score/:gameId`).
 *
 * A port of point-hub's `manualSource.apply()` (the LedBox console), reduced to what
 * a phone at the side of the court needs: points, sets and the serve arrow — no
 * timeouts, substitutions or change of ends. Home is always team A, away always B.
 *
 * Kept from point-hub, because each one is a bug the hall once saw:
 *  - A set is won at 25 (15 in the deciding fifth) by two, UNCAPPED — deuce runs on.
 *  - The set is awarded once, on the transition. A second tap on the set point by the
 *    winner is refused while the board still holds the closing score (a double tap
 *    must not read 26:10 while the pill says 25:10). The loser's "+" and every "−"
 *    stay open: they are how a mis-scored rally is corrected before the next set.
 *  - A "−" that walks the winner back below the winning condition takes the set back
 *    with it, keyed on the recorded winner — otherwise a mis-tapped 25:23 stays
 *    counted and the real one a rally later counts twice.
 *  - The side that wins the rally serves next.
 *
 * point-hub's in-memory `setClosed` flag lives in the published row instead: `event`
 * stays 'set-end' / 'match-end' from the set point until NEXT SET (or until a "−"
 * takes the set back). Two phones score the same row, and a flag only one of them
 * held would let the other award the same set twice after a loser's correction
 * (25:23 → 25:24 → the winner's "+" at 26:24). Everything here is a pure function of
 * a published `live_scores` state.
 */

export type ScoreStatus = 'idle' | 'live' | 'final'

export interface ScoreState {
  points_a: number
  points_b: number
  sets_won_a: number
  sets_won_b: number
  set_results: { a: number; b: number }[]
  /** left = home (team A), right = away (team B) — the board's own convention. */
  serving_team: 'left' | 'right' | null
  status: ScoreStatus
  event: 'set-end' | 'match-end' | null
}

export type Side = 'a' | 'b'

export const SETS_TO_WIN = 3
const MAX_SETS = SETS_TO_WIN * 2 - 1

export const EMPTY_STATE: ScoreState = {
  points_a: 0, points_b: 0, sets_won_a: 0, sets_won_b: 0,
  set_results: [], serving_team: null, status: 'idle', event: null,
}

const other = (s: Side): Side => (s === 'a' ? 'b' : 'a')
const pts = (st: ScoreState, s: Side) => (s === 'a' ? st.points_a : st.points_b)
const serveOf = (s: Side): 'left' | 'right' => (s === 'a' ? 'left' : 'right')

/** Between the set point and NEXT SET — the board still holds the finished set. */
export function isSetClosed(st: ScoreState): boolean {
  return st.event === 'set-end' || st.event === 'match-end'
}

/** Is the set being played (or just finished) the deciding fifth? */
function isDeciding(st: ScoreState): boolean {
  const setIndex = isSetClosed(st) ? st.set_results.length - 1 : st.set_results.length
  return setIndex === MAX_SETS - 1
}

const targetOf = (st: ScoreState) => (isDeciding(st) ? 15 : 25)

const isWon = (mine: number, theirs: number, target: number) => mine >= target && mine - theirs >= 2

export function matchOver(st: ScoreState): boolean {
  return st.sets_won_a >= SETS_TO_WIN || st.sets_won_b >= SETS_TO_WIN
}

/** Who won the set that is still closed, or null while a set is being played. */
export function closedWinner(st: ScoreState): Side | null {
  if (!isSetClosed(st)) return null
  const last = st.set_results[st.set_results.length - 1]
  if (!last || last.a === last.b) return null
  return last.a > last.b ? 'a' : 'b'
}

/** The set number to show: the one being played, or the one just finished. */
export function currentSet(st: ScoreState): number {
  return isSetClosed(st) ? st.set_results.length : Math.min(st.set_results.length + 1, MAX_SETS)
}

export function addPoint(st: ScoreState, side: Side): ScoreState {
  const winner = closedWinner(st)
  const last = st.set_results[st.set_results.length - 1]
  // The winner tapping the set point again while the board still shows it: nothing moves.
  if (winner === side && last && last.a === st.points_a && last.b === st.points_b) return st
  const key = side === 'a' ? 'points_a' : 'points_b'
  const next: ScoreState = { ...st, [key]: pts(st, side) + 1, serving_team: serveOf(side) }
  if (next.status === 'idle') next.status = 'live'
  if (winner) return next // a correction inside a closed set never awards another one
  const target = targetOf(st)
  const wonBefore = isWon(pts(st, side), pts(st, other(side)), target)
  const wonNow = isWon(pts(next, side), pts(next, other(side)), target)
  next.event = null
  if (!wonBefore && wonNow) {
    next.set_results = [...st.set_results, { a: next.points_a, b: next.points_b }]
    if (side === 'a') next.sets_won_a = st.sets_won_a + 1
    else next.sets_won_b = st.sets_won_b + 1
    next.event = matchOver(next) ? 'match-end' : 'set-end'
  }
  return next
}

export function removePoint(st: ScoreState, side: Side): ScoreState {
  if (pts(st, side) === 0) return st
  const key = side === 'a' ? 'points_a' : 'points_b'
  const next: ScoreState = { ...st, [key]: pts(st, side) - 1 }
  // Keyed on the recorded WINNER: that also catches 25:24 → 24:24 after a loser's
  // correction, and stops the loser's "−" at 25:27 → 25:26 popping a set they never had.
  if (closedWinner(st) === side && !isWon(pts(next, side), pts(next, other(side)), targetOf(st))) {
    next.set_results = st.set_results.slice(0, -1)
    if (side === 'a') next.sets_won_a = st.sets_won_a - 1
    else next.sets_won_b = st.sets_won_b - 1
    next.event = null
    if (next.status === 'final') next.status = 'live'
  }
  return next
}

/** Start the next set. Only once the current one is won and the match is not. */
export function nextSet(st: ScoreState): ScoreState {
  if (!isSetClosed(st) || matchOver(st)) return st
  // FIVB 12.1.2 needs who served FIRST last set, which two phones cannot agree on
  // reliably; the first rally of the new set sets the arrow instead.
  return { ...st, points_a: 0, points_b: 0, serving_team: null, event: null }
}

export function finish(st: ScoreState): ScoreState {
  return { ...st, status: 'final' }
}

export function reopen(st: ScoreState): ScoreState {
  return { ...st, status: 'live' }
}

export function setServe(st: ScoreState, side: Side): ScoreState {
  return { ...st, serving_team: serveOf(side) }
}

/** A `live_scores` row (or null) → the state the rules above work on. */
export function stateFromRow(row: Record<string, unknown> | null | undefined): ScoreState {
  if (!row) return EMPTY_STATE
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const results = Array.isArray(row.set_results)
    ? (row.set_results as { a: unknown; b: unknown }[]).map((r) => ({ a: n(r?.a), b: n(r?.b) }))
    : []
  const status = row.status === 'live' || row.status === 'final' ? row.status : 'idle'
  const serving = row.serving_team === 'left' || row.serving_team === 'right' ? row.serving_team : null
  const event = row.event === 'set-end' || row.event === 'match-end' ? row.event : null
  return {
    points_a: n(row.points_a), points_b: n(row.points_b),
    sets_won_a: n(row.sets_won_a), sets_won_b: n(row.sets_won_b),
    set_results: results, serving_team: serving, status, event,
  }
}
