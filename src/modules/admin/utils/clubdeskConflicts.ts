import { kscwApi } from '../../../lib/api'

/**
 * Stage `conflict` proposals for every live value disagreement (migration 338).
 *
 * ⚠ Must be called after EVERY sync-down the UI triggers, from whichever button
 * ran it. The sync-down's own SQL pass stages fill / overwrite / set_true /
 * create; conflicts are computed in JS off computeClubdeskDrift() — the same
 * function that renders the finding — so they are staged over HTTP afterwards
 * instead. Idempotent: a second call stages 0.
 *
 * ⓘ The cron sync-downs (weekly Sat 22:00 UTC, and any host-run one) have no
 * browser to make this call. They are covered by the scheduled hook instead,
 * which fires on `down_last_success_at` moving past `conflicts_staged_at`
 * (migration 339) — so this call and that hook are the same route, and whichever
 * gets there first closes the window for the other.
 *
 * ⚠ A 404 is not a failure here, it is a DEPLOY WINDOW. Cloudflare Pages ships
 * this page automatically on push while `ext:deploy` is run by hand, so for a
 * few minutes the frontend can be asking for a route the endpoint does not have
 * yet. Alarming the operator about that teaches them to ignore the toast that
 * will one day mean something; the hook stages the same conflicts within 15
 * minutes regardless. Returns null so the caller can stay silent rather than
 * report "0 staged", which would be a different and untrue claim.
 */
export interface ConflictStagingResult {
  staged: number
  /** How many conflicts were found, which is not how many were staged when capped. */
  considered: number
  /**
   * The server refused to stage because the count exceeded its runaway cap — a
   * stale or half-loaded clubdesk_export makes hundreds of members "disagree" at
   * once. `staged` is 0 and that is NOT "nothing to decide": the caller must say
   * so, or the loudest possible data fault reads as the quietest possible
   * all-clear.
   */
  capped: boolean
  cap: number
}

export async function detectClubdeskConflicts(): Promise<ConflictStagingResult | null> {
  try {
    const r = await kscwApi<Partial<ConflictStagingResult>>(
      '/clubdesk-sync/proposals/detect', { method: 'POST' },
    )
    return {
      staged: Number(r?.staged) || 0,
      considered: Number(r?.considered) || 0,
      capped: r?.capped === true,
      cap: Number(r?.cap) || 0,
    }
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null
    throw e
  }
}
