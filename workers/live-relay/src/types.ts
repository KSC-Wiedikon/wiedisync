// Shared message shapes for the live-scoring relay.
//
// `BoardState` is EXACTLY the object returned by the LedBox bridge's
// `manualSource.getState()` (see ledbox-bridge/src/manualSource.js). The relay
// treats it as an opaque snapshot and never mutates it — it only wraps it in an
// envelope and fans it out. Keeping it verbatim means the board hook can forward
// getState() with zero transformation.

/** A completed-set final score, one physical side each (a=left by getState()'s projection). */
export interface SetResult {
  a: number
  b: number
}

/** The full board snapshot — 1:1 with manualSource.getState(). */
export interface BoardState {
  side_a: 'left' // getState() always projects team A onto the left side
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
  serving_team: 'left' | 'right' | null // 'left' => team A serves, 'right' => team B
  set_results: SetResult[]
}

/** The notable event manualSource attaches to a scoring action. */
export type MatchEvent = 'set-end' | 'match-end' | 'switch-8' | null

/** Board -> relay publish body (POST /publish/:channel, bearer-authed). */
export interface PublishBody {
  state: BoardState
  event?: MatchEvent
  /** Board-side wall-clock (ms epoch). Relay falls back to its own clock if absent. */
  ts?: number
}

/** Relay -> app envelope (SSE `data:` payload for snapshot/update frames). */
export interface Envelope {
  v: 1
  channel: string
  /** live = a match is in progress; idle = board blank/no match; final = last match ended. */
  status: 'live' | 'idle' | 'final'
  /** Monotonic sequence — also emitted as the SSE `id:` for Last-Event-ID resume. */
  seq: number
  event: MatchEvent
  ts: number
  match: BoardState | null
}

/** One archived completed match (GET /history/:channel). */
export interface HistoryRow {
  ended_at: number
  team_a: string
  team_b: string
  sets_a: number
  sets_b: number
  set_results: SetResult[]
  snapshot: BoardState
}

export interface Env {
  LIVE: DurableObjectNamespace
  ALLOWED_ORIGINS: string
  DEFAULT_CHANNEL: string
  /** Secret — the board's publish bearer token. Set via `wrangler secret put`. */
  RELAY_TOKEN?: string
}
