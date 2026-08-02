// Live-scoring message shapes — mirror the relay's contract
// (workers/live-relay/src/types.ts), which in turn mirrors the LedBox bridge's
// manualSource.getState(). Kept as a local copy so the app module is
// self-contained (the Worker is a separate build).

/** Full board snapshot — 1:1 with the LedBox bridge's manualSource.getState(). */
export interface BoardState {
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
  serving_team: 'left' | 'right' | null // 'left' => team A serves, 'right' => team B
  set_results: Array<{ a: number; b: number }>
}

export type MatchEvent = 'set-end' | 'match-end' | 'switch-8' | null

/** SSE `data:` payload the relay sends on every snapshot/update frame. */
export interface Envelope {
  v: 1
  channel: string
  status: 'live' | 'idle' | 'final'
  seq: number
  event: MatchEvent
  ts: number
  match: BoardState | null
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
  serving: boolean
}
