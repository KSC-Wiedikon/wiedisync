// Live-scoring message shapes.
//
// The LedBox board publishes its state to a Directus `live_scores` row (one row
// per channel / physical scoreboard); the app reads that row (~3s poll + an
// optional realtime subscription) and normalises it into the `Envelope` the UI
// renders. `BoardState` is 1:1 with the LedBox bridge's manualSource.getState();
// `LiveScoreRow` is the raw Directus row — getState() flattened, plus a
// status/event/ts wrapper. See src/modules/live/DIRECTUS-SETUP.md for the
// collection definition. (The earlier Durable-Object relay design — retired as
// the paid alternative — lives under workers/live-relay/.)

/**
 * Which game the board is running. The row is a superset of all three — the page
 * renders only the columns the sport actually uses:
 *
 *   volleyball  points (current set) · sets · timeouts · subs · serve · set results
 *   beach       same, minus subs (beach has no substitutions; the team name is a
 *               two-player pair, e.g. "Müller / Meier")
 *   basketball  points (running) · period · team fouls + bonus · timeouts ·
 *               possession arrow. No sets.
 */
export type LiveSport = 'volleyball' | 'beach' | 'basketball'

/** Full board snapshot — 1:1 with the LedBox bridge's manualSource.getState(). */
export interface BoardState {
  sport: LiveSport
  side_a: 'left'
  team_a_name: string
  team_a_short: string
  team_a_color: string
  team_b_name: string
  team_b_short: string
  team_b_color: string
  points_a: number
  points_b: number
  sets_won_a: number
  sets_won_b: number
  timeouts_a: number
  timeouts_b: number
  subs_a: number
  subs_b: number
  /** Basketball team fouls in the CURRENT period. 5+ puts the opponent in the bonus. */
  fouls_a: number
  fouls_b: number
  /** Basketball period: 1..4 = Q1..Q4, 5+ = overtime. 0 = not published. */
  period: number
  /** The firmware's own match-over flag. A hint — `Envelope.status` is authoritative. */
  over: boolean
  /**
   * Volleyball/beach: which side serves. Basketball: the POSSESSION ARROW — the
   * left/right semantics are identical, so it needs no column of its own.
   */
  serving_team: 'left' | 'right' | null // 'left' => team A, 'right' => team B
  set_results: Array<{ a: number; b: number }>
}

export type MatchEvent = 'set-end' | 'match-end' | 'switch-8' | null

export type LiveStatus = 'live' | 'idle' | 'final'

/**
 * Normalised live snapshot the UI renders — built from a `live_scores` row by
 * useLiveMatch. (Was an SSE frame in the retired Durable-Object relay design;
 * the shape is kept so LivePage/Scoreboard are unchanged.)
 */
export interface Envelope {
  v: 1
  channel: string
  status: LiveStatus
  /** Monotonic-ish sequence for staleness checks — the board's `ts` (ms epoch). */
  seq: number
  event: MatchEvent
  ts: number
  match: BoardState | null
}

/**
 * Raw Directus `live_scores` row — the board's manualSource.getState() flattened
 * into columns, plus a `status`/`event`/`ts` wrapper. One row per channel (its
 * manual string primary key). `set_results` is a Directus `json` field; `ts` is a
 * `bigInteger` and may deserialise as a string, so coerce with `Number(...)`.
 * All numeric reads go through the shared Directus client WITHOUT api.ts's
 * `stringifyId` (which would turn scores into strings), so numbers stay numbers.
 */
export interface LiveScoreRow {
  channel: string
  status: LiveStatus | null
  event: MatchEvent
  ts: number | string | null
  /** Null/unknown on an old row written before multi-sport → treated as volleyball. */
  sport: LiveSport | null
  period: number | string | null
  over: boolean | null
  side_a: 'left'
  team_a_name: string | null
  team_a_short: string | null
  team_a_color: string | null
  team_b_name: string | null
  team_b_short: string | null
  team_b_color: string | null
  points_a: number | null
  points_b: number | null
  sets_won_a: number | null
  sets_won_b: number | null
  timeouts_a: number | null
  timeouts_b: number | null
  subs_a: number | null
  subs_b: number | null
  fouls_a: number | null
  fouls_b: number | null
  serving_team: 'left' | 'right' | null
  set_results: Array<{ a: number; b: number }> | null
  date_updated?: string | null
}

/** Connection lifecycle of the underlying EventSource. */
export type Connection = 'connecting' | 'open' | 'reconnecting'

/**
 * A team's view, resolved from either side of the board. `getState()` always
 * projects team A onto the left, so `serving` is derived directly from
 * `serving_team` without any side bookkeeping in the UI.
 */
export interface TeamView {
  name: string
  short: string
  color: string
  points: number
  sets: number
  timeouts: number
  subs: number
  fouls: number
  /** Volleyball/beach: this team serves. Basketball: the possession arrow points here. */
  serving: boolean
  /**
   * Basketball: this team shoots free throws on the next defensive foul, i.e. the
   * OPPONENT has reached the 5-team-foul limit for the period.
   */
  inBonus: boolean
}
