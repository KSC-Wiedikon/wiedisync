// Pure logic for the match-over view (FinalSummary). Kept out of the component so
// it is unit-testable in vitest's node environment and react-refresh sees the
// component file as component-only.

import { toTeams } from './scoreboard'
import type { BoardState, LiveSport, TeamView } from './types'

export type Side = 0 | 1

export interface FinalSetRow {
  /** 1-based set number. */
  n: number
  a: number
  b: number
  winner: Side | null
  /** Playing time in seconds, or null when the board didn't measure this set. */
  dur: number | null
}

/**
 * How a basketball game ended, in terms of periods. `partial` is a board stopped
 * before the end of Q4 (or corrected by hand) — say which quarter, don't pretend.
 */
export type BasketballEnd =
  | { kind: 'regulation' }
  | { kind: 'overtime'; n: number }
  | { kind: 'partial'; n: number }

export interface FinalView {
  sport: LiveSport
  /** Volleyball/beach are decided on sets, basketball on points. */
  bySets: boolean
  teams: [TeamView, TeamView]
  score: [number, number]
  winner: Side | null
  /** Volleyball/beach only; always empty for basketball. */
  sets: FinalSetRow[]
  /** Sum of the set durations (seconds) — only when EVERY set has one. */
  totalDur: number | null
  /** Basketball only. */
  basketballEnd: BasketballEnd | null
}

function sideOf(a: number, b: number): Side | null {
  return a > b ? 0 : b > a ? 1 : null
}

function basketballEnd(period: number): BasketballEnd | null {
  if (!period || period < 1) return null
  if (period === 4) return { kind: 'regulation' }
  if (period > 4) return { kind: 'overtime', n: period - 4 }
  return { kind: 'partial', n: period }
}

export function buildFinalView(state: BoardState): FinalView {
  const teams = toTeams(state)
  const bySets = state.sport !== 'basketball'
  const results = bySets ? (state.set_results ?? []) : []

  const sets: FinalSetRow[] = results.map((r, i) => ({
    n: i + 1,
    a: r.a,
    b: r.b,
    winner: sideOf(r.a, r.b),
    dur: typeof r.dur === 'number' && Number.isFinite(r.dur) && r.dur >= 0 ? r.dur : null,
  }))

  let score: [number, number]
  if (bySets) {
    score = [teams[0].sets, teams[1].sets]
    // A row that carries set results but no set tally (older board / hand edit):
    // count the sets rather than showing a meaningless 0:0.
    if (score[0] === 0 && score[1] === 0 && sets.length > 0) {
      score = [
        sets.filter((s) => s.winner === 0).length,
        sets.filter((s) => s.winner === 1).length,
      ]
    }
  } else {
    score = [teams[0].points, teams[1].points]
  }

  const totalDur =
    sets.length > 0 && sets.every((s) => s.dur !== null)
      ? sets.reduce((sum, s) => sum + (s.dur as number), 0)
      : null

  return {
    sport: state.sport,
    bySets,
    teams,
    score,
    winner: sideOf(score[0], score[1]),
    sets,
    totalDur,
    basketballEnd: bySets ? null : basketballEnd(state.period),
  }
}

/**
 * Seconds → whole minutes, split into hours + minutes for display. Rounded to
 * the nearest minute; anything measured but under half a minute shows as 1 min
 * rather than a misleading "0 min".
 */
export function durationParts(seconds: number): { h: number; m: number } {
  const s = Math.max(0, seconds)
  let total = Math.round(s / 60)
  if (total === 0 && s > 0) total = 1
  return { h: Math.floor(total / 60), m: total % 60 }
}

/** Total match time of a `live_history` row's set_results — null unless all sets were timed. */
export function totalSetDuration(results: ReadonlyArray<{ dur?: number }> | null | undefined): number | null {
  if (!results || results.length === 0) return null
  let sum = 0
  for (const r of results) {
    if (typeof r.dur !== 'number' || !Number.isFinite(r.dur) || r.dur < 0) return null
    sum += r.dur
  }
  return sum
}

/** Minimal translate signature, so the formatter stays testable without i18next. */
type Translate = (key: 'durationMin' | 'durationHourMin', opts: { h?: number; m: number }) => string

/** "24 min", or "1 h 32 min" from an hour up. */
export function formatDuration(seconds: number, t: Translate): string {
  const { h, m } = durationParts(seconds)
  return h > 0 ? t('durationHourMin', { h, m }) : t('durationMin', { m })
}
