/**
 * Game results — official vs provisional (migration 395).
 *
 * A played volleyball game gets its official score from the SV feed (sv-sync sets
 * `status = 'completed'`), which can lag by days. Until then the team — or the
 * opponent's VolleyManager report — gives a PROVISIONAL score. Every surface shows
 * one or the other through `displayResult`, so the rule "official wins, provisional
 * is marked" lives in one place. The provisional columns are never cleared: once
 * the game is official they are history, and this module ignores them.
 *
 * `validateSets` mirrors the backend's (game-result.js) so the form refuses what the
 * endpoint would 400 on, before the round-trip.
 */
import type { Game, Ranking } from '../types'
import { isCupGame } from './leagueClassification'

export interface SetScore { home: number; away: number }

export type ProvisionalSource = NonNullable<Game['provisional_source']>

export interface DisplayResult {
  kind: 'official' | 'provisional' | 'none'
  home: number | null
  away: number | null
  sets: SetScore[]
  /** Provisional source; null for official / none. */
  source: ProvisionalSource | null
}

/** Keep only well-formed `{home, away}` entries (sets_json is untyped JSON). */
export function parseSets(json: unknown): SetScore[] {
  if (!Array.isArray(json)) return []
  return json
    .filter((s): s is { home: unknown; away: unknown } => typeof s === 'object' && s !== null && 'home' in s && 'away' in s)
    .map((s) => ({ home: Number(s.home), away: Number(s.away) }))
    .filter((s) => Number.isFinite(s.home) && Number.isFinite(s.away))
}

type ResultFields = Pick<Game, 'status' | 'home_score' | 'away_score' | 'sets_json'>
  & Partial<Pick<Game, 'provisional_home_score' | 'provisional_away_score' | 'provisional_sets_json' | 'provisional_source'>>

export function displayResult(game: ResultFields): DisplayResult {
  // A postponed / cancelled game was not played (or not yet): a provisional result
  // left over from before the move is stale, and must neither show nor count.
  if (game.status === 'postponed' || game.status === 'cancelled') {
    return { kind: 'none', home: null, away: null, sets: [], source: null }
  }
  if (game.status === 'completed') {
    return {
      kind: 'official',
      home: game.home_score == null ? null : Number(game.home_score),
      away: game.away_score == null ? null : Number(game.away_score),
      sets: parseSets(game.sets_json),
      source: null,
    }
  }
  if (game.provisional_home_score != null && game.provisional_away_score != null) {
    return {
      kind: 'provisional',
      home: Number(game.provisional_home_score),
      away: Number(game.provisional_away_score),
      sets: parseSets(game.provisional_sets_json),
      source: game.provisional_source ?? null,
    }
  }
  return { kind: 'none', home: null, away: null, sets: [], source: null }
}

export type SetsError =
  | 'no_sets'
  | 'too_many_sets'
  | 'not_integer'
  | 'out_of_range'
  | 'set_tied'
  | 'set_too_short'
  | 'set_margin'
  | 'set_after_decided'
  | 'not_decided'

export interface SetsValidation {
  ok: boolean
  error: SetsError | null
  /** 1-based set the error is about, when it is about one set. */
  set: number | null
  /** Sets won — meaningful only when ok. */
  home: number
  away: number
}

/**
 * The rules the endpoint enforces: 1..5 sets of integers 0..99; each set won by ≥ 2
 * with the winner on ≥ 25 (≥ 15 in the deciding set — set 5 of best-of-5, set 3 of
 * best-of-3); the match winner reaches `neededSets` and no set follows the deciding
 * one. `neededSets` null = unknown league format: accept either, from the sets.
 */
export function validateSets(sets: SetScore[], neededSets: 2 | 3 | null): SetsValidation {
  const fail = (error: SetsError, set: number | null = null): SetsValidation =>
    ({ ok: false, error, set, home: 0, away: 0 })
  if (!Array.isArray(sets) || sets.length === 0) return fail('no_sets')
  if (sets.length > 5) return fail('too_many_sets')
  for (let i = 0; i < sets.length; i++) {
    const { home, away } = sets[i]
    if (!Number.isInteger(home) || !Number.isInteger(away)) return fail('not_integer', i + 1)
    if (home < 0 || away < 0 || home > 99 || away > 99) return fail('out_of_range', i + 1)
    if (home === away) return fail('set_tied', i + 1)
  }

  const homeWins = sets.filter((s) => s.home > s.away).length
  const awayWins = sets.length - homeWins
  const needed = neededSets ?? (Math.max(homeWins, awayWins) >= 3 ? 3 : 2)
  if (sets.length > needed * 2 - 1) return fail('too_many_sets')
  const decidingIndex = needed * 2 - 2

  let h = 0
  let a = 0
  for (let i = 0; i < sets.length; i++) {
    if (h === needed || a === needed) return fail('set_after_decided', i + 1)
    const { home, away } = sets[i]
    const winner = Math.max(home, away)
    const minimum = i === decidingIndex ? 15 : 25
    if (winner < minimum) return fail('set_too_short', i + 1)
    if (Math.abs(home - away) < 2) return fail('set_margin', i + 1)
    if (home > away) h++
    else a++
  }
  if (h !== needed && a !== needed) return fail('not_decided')
  return { ok: true, error: null, set: null, home: h, away: a }
}

/** Two set lists describe the same result (order matters). */
export function setsEqual(a: SetScore[] | null | undefined, b: SetScore[] | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false
  return a.every((s, i) => s.home === b[i].home && s.away === b[i].away)
}

/**
 * What the result form starts with. Our own earlier report wins over the opponent's
 * when the two differ — prefilling theirs would turn the action into a plain
 * "Confirm result" that silently overwrites what we reported; with ours in the form
 * the conflict (and "Report ours anyway") shows instead. Otherwise: opponent report
 * > our provisional > final live score > empty (`neededSets` best-of-N rows).
 */
export function pickResultPrefill(input: {
  opponent: { sets: SetScore[] } | null | undefined
  own: { sets: SetScore[] } | null | undefined
  provisional: { sets: SetScore[]; source: string | null } | null | undefined
  live: { sets: SetScore[]; final: boolean } | null | undefined
}): { sets: SetScore[] | null; from: 'opponent' | 'own' | 'live' | null } {
  const { opponent, own, provisional, live } = input
  const ours = provisional?.source === 'own' && provisional.sets.length
    ? provisional.sets
    : own?.sets.length ? own.sets : null
  if (opponent?.sets.length) {
    if (ours && !setsEqual(ours, opponent.sets)) return { sets: ours, from: 'own' }
    return { sets: opponent.sets, from: 'opponent' }
  }
  if (provisional?.sets.length) return { sets: provisional.sets, from: null }
  if (live?.final && live.sets.length) return { sets: live.sets, from: 'live' }
  return { sets: null, from: null }
}

/** VM skip / failure reasons the UI explains. Anything else (a raw worker message,
 *  a code added to the backend later) gets the generic line — never raw text. */
const VM_REASONS = new Set([
  'derby', 'home_team_reports', 'not_reportable', 'no_vm_game', 'vm_not_configured', 'dry_run',
  'worker_lost', 'opponent_differs', 'spawn_failed', 'queued_window', 'party_changed', 'timeout',
])

/** The `live` i18n key for a `vm_result_error` reason; null when there is none. */
export function vmReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null
  // worker_exit_<code>: the exit code is for the logs, not for the member.
  if (reason.startsWith('worker_exit_')) return 'result_reason_worker_exit'
  // The worker writes `party_changed (hometeam → awayteam)` — the parties are for the logs.
  if (reason.startsWith('party_changed')) return 'result_reason_party_changed'
  return VM_REASONS.has(reason) ? `result_reason_${reason}` : 'result_reason_unknown'
}

// ── Rankings ────────────────────────────────────────────────────────────────

/**
 * Leagues that are not a regular-season table (cup rounds, tournaments, playoff
 * groups). GamesPage leaves them out of the standings; a game in one never counts.
 */
export const NON_STANDINGS_LEAGUE = /^Group \d+$|Cup|Turnier|Pokal|Final|Runde \d|Spiel \d|Tour \d/i

type RankingGame = Pick<Game, 'id' | 'status' | 'home_team' | 'away_team' | 'league'>
  & Partial<Pick<Game, 'game_id' | 'round' | 'provisional_home_score' | 'provisional_away_score' | 'provisional_sets_json' | 'provisional_source' | 'provisional_at' | 'home_score' | 'away_score' | 'sets_json'>>

const SOURCE_RANK: Record<string, number> = { confirmed: 4, vm_official: 3, own: 2, opponent: 1 }

/**
 * One row per played game. An intra-club derby has two `games` rows sharing a
 * `game_id` (one per KSCW side), and each can carry its own provisional result —
 * counting both would score the game twice. Keep the most trustworthy source
 * (confirmed > vm_official > own > opponent), then the newest `provisional_at`.
 * Rows without a `game_id` stay as they are.
 */
export function dedupeProvisionalGames<T extends RankingGame>(games: T[]): T[] {
  const best = new Map<string, T>()
  const rest: T[] = []
  for (const g of games) {
    if (!g.game_id) { rest.push(g); continue }
    const cur = best.get(g.game_id)
    if (!cur) { best.set(g.game_id, g); continue }
    const diff = (SOURCE_RANK[g.provisional_source ?? ''] ?? 0) - (SOURCE_RANK[cur.provisional_source ?? ''] ?? 0)
    if (diff > 0 || (diff === 0 && (g.provisional_at ?? '') > (cur.provisional_at ?? ''))) best.set(g.game_id, g)
  }
  return [...best.values(), ...rest]
}

export type RankingRow = Ranking & { provisional?: boolean }

function normName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function quotient(won: number, lost: number): number {
  if (lost > 0) return won / lost
  return won > 0 ? Number.POSITIVE_INFINITY : 0
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The standings as they would read with every provisional KSCW result counted.
 *
 * Only games that are provisional (not official), not a cup game, and whose BOTH
 * teams sit in the ranking group whose league EXACTLY equals the game's `league`
 * are applied. Anything else is skipped: a half-applied game would give one team
 * points nobody lost. Callers dedupe derby rows first (`dedupeProvisionalGames`). Points: a clear win (3:0 / 3:1, or 2:0)
 * 3/0, a narrow one (3:2, 2:1) 2/1. Re-ranked by points, wins, set quotient, ball
 * quotient; each touched row carries `provisional: true`. Without any applicable
 * game the input rows come back unchanged (original ranks kept).
 */
export function applyProvisionalToRankings(rows: Ranking[], games: RankingGame[]): RankingRow[] {
  const byLeague = new Map<string, RankingRow[]>()
  const copies: RankingRow[] = rows.map((r) => ({ ...r }))
  for (const r of copies) {
    const list = byLeague.get(r.league) ?? []
    list.push(r)
    byLeague.set(r.league, list)
  }

  const touchedLeagues = new Set<string>()
  for (const g of games) {
    // Cup games never count, not even when a cup round sits under a league's name.
    // The round only by the narrow cup test: "Runde 3" / "Final" are ordinary
    // league round labels too.
    if (NON_STANDINGS_LEAGUE.test(g.league ?? '') || isCupGame(g.round)) continue
    const res = displayResult({
      status: g.status,
      home_score: g.home_score ?? 0,
      away_score: g.away_score ?? 0,
      sets_json: g.sets_json ?? null,
      provisional_home_score: g.provisional_home_score,
      provisional_away_score: g.provisional_away_score,
      provisional_sets_json: g.provisional_sets_json,
      provisional_source: g.provisional_source,
    })
    if (res.kind !== 'provisional' || res.home == null || res.away == null || res.home === res.away) continue

    const home = normName(g.home_team)
    const away = normName(g.away_team)
    const findPair = (list: RankingRow[] | undefined) => {
      if (!list) return null
      const h = list.find((r) => normName(r.team_name) === home)
      const a = list.find((r) => normName(r.team_name) === away)
      return h && a && h !== a ? { h, a } : null
    }
    // Only the table of the game's own league. Two clubs can meet in several
    // competitions whose tables all list both names; a fallback to "any group with
    // both" credited a game to the wrong one.
    const league = g.league
    const pair = findPair(byLeague.get(league))
    if (!pair) continue

    const homeWon = res.home > res.away
    const winner = homeWon ? pair.h : pair.a
    const loser = homeWon ? pair.a : pair.h
    const winSets = Math.max(res.home, res.away)
    const loseSets = Math.min(res.home, res.away)
    const narrow = loseSets === winSets - 1 && winSets >= 2
    const ballsHome = res.sets.reduce((s, x) => s + x.home, 0)
    const ballsAway = res.sets.reduce((s, x) => s + x.away, 0)

    for (const [row, isHome] of [[pair.h, true], [pair.a, false]] as const) {
      row.played = num(row.played) + 1
      row.sets_won = num(row.sets_won) + (isHome ? res.home : res.away)
      row.sets_lost = num(row.sets_lost) + (isHome ? res.away : res.home)
      row.points_won = num(row.points_won) + (isHome ? ballsHome : ballsAway)
      row.points_lost = num(row.points_lost) + (isHome ? ballsAway : ballsHome)
      row.provisional = true
    }
    winner.won = num(winner.won) + 1
    winner.points = num(winner.points) + (narrow ? 2 : 3)
    loser.lost = num(loser.lost) + 1
    loser.points = num(loser.points) + (narrow ? 1 : 0)
    if (narrow) {
      if (typeof winner.wins_narrow === 'number') winner.wins_narrow += 1
      if (typeof loser.defeats_narrow === 'number') loser.defeats_narrow += 1
    } else {
      if (typeof winner.wins_clear === 'number') winner.wins_clear += 1
      if (typeof loser.defeats_clear === 'number') loser.defeats_clear += 1
    }
    touchedLeagues.add(league)
  }

  if (touchedLeagues.size === 0) return rows.map((r) => ({ ...r }))

  for (const league of touchedLeagues) {
    const list = byLeague.get(league)!
    const ordered = [...list].sort((x, y) =>
      num(y.points) - num(x.points)
      || num(y.won) - num(x.won)
      || quotient(num(y.sets_won), num(y.sets_lost)) - quotient(num(x.sets_won), num(x.sets_lost))
      || quotient(num(y.points_won), num(y.points_lost)) - quotient(num(x.points_won), num(x.points_lost))
      || num(x.rank) - num(y.rank))
    ordered.forEach((r, i) => { r.rank = i + 1 })
  }
  return copies
}
